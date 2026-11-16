#!/usr/bin/python3
"""Read-only comparison of the declared, on-disk and active fail2ban policy.

The protocol/command dump is pinned to Debian fail2ban 1.1.0. Never send the
dump back to the daemon: socket requests below are exclusively status/get.
Exit 0 includes drift; exit 2 means the observation cannot be trusted.
"""
import argparse
import ast
import ipaddress
import json
import re
import subprocess


class PolicyError(ValueError):
    """Invalid policy, unsupported response or failed read-only observation."""


def integer(value):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]+", str(value)):
        raise PolicyError("Expected a nonnegative integer")
    return int(value)


def seconds(value):
    match = re.fullmatch(r"([0-9]+)([smhd]?)", str(value))
    if not match:
        raise PolicyError("Unsupported duration")
    return int(match[1]) * {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[match[2]]


def ports(value):
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, (list, tuple)) or not value:
        raise PolicyError("Expected a nonempty port list")
    result = sorted(set(integer(str(port).strip()) for port in value))
    if result[0] < 1 or result[-1] > 65535:
        raise PolicyError("Invalid port")
    return result


def addresses(value):
    if not isinstance(value, (list, tuple)):
        raise PolicyError("Expected an address list")
    try:
        return sorted({str(ipaddress.ip_network(str(item), strict=False)) for item in value})
    except ValueError as error:
        raise PolicyError("Unsupported ignore address") from error


def strings(value):
    if not isinstance(value, (list, tuple)) or not all(isinstance(item, str) for item in value):
        raise PolicyError("Expected a list of strings")
    return list(value)


def declared_policy(value):
    required = {"jail", "ports", "maxretry", "findtime", "bantime", "ignoreip", "backend", "action"}
    if not isinstance(value, dict) or set(value) != required:
        raise PolicyError("Unexpected declared policy fields")
    for key in ("jail", "action"):
        if not isinstance(value[key], str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", value[key]):
            raise PolicyError("Invalid policy name")
    if value["backend"] not in ("systemd", "polling", "pyinotify"):
        raise PolicyError("An explicit supported backend is required")
    result = dict(value)
    result.update(ports=ports(value["ports"]), maxretry=integer(value["maxretry"]),
                  findtime=seconds(value["findtime"]), bantime=seconds(value["bantime"]),
                  ignoreip=addresses(value["ignoreip"]))
    if min(result["maxretry"], result["findtime"], result["bantime"]) < 1:
        raise PolicyError("Policy limits must be positive")
    return result


def journal_groups(commands):
    groups = []
    for command in commands:
        current = []
        for token in strings(command):
            if token == "+":
                if not current:
                    raise PolicyError("Empty journal match group")
                groups.append(sorted(set(current)))
                current = []
            else:
                if "=" not in token:
                    raise PolicyError("Unsupported journal match token")
                current.append(token)
        if not current:
            raise PolicyError("Empty journal match group")
        groups.append(sorted(set(current)))
    return sorted(set(tuple(group) for group in groups))


def parse_dump(text, jail):
    """Read fail2ban-client -d literals; never evaluate or execute commands."""
    result = {"actions": {}, "ignoreip": [], "failregex": [], "ignoreregex": [],
              "journal_commands": [], "prefregex": "", "usedns": "warn", "maxlines": 1,
              "ignorecommand": False, "ignoreself": True}
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            command = ast.literal_eval(line)
        except (ValueError, SyntaxError) as error:
            raise PolicyError("Unsupported fail2ban command dump") from error
        if not isinstance(command, list) or not command or not isinstance(command[0], str):
            raise PolicyError("Invalid fail2ban command dump entry")
        if command[0] == "config-error":
            raise PolicyError("fail2ban reported a configuration error")
        if len(command) < 2 or command[1] != jail:
            continue
        if command[0] == "add" and len(command) == 3:
            if "backend" in result:
                raise PolicyError("Duplicate jail in command dump")
            result["backend"] = command[2]
        elif command[0] in ("set", "multi-set") and len(command) >= 4:
            option, values = command[2], command[3:]
            if option in ("addfailregex", "addignoreregex"):
                result[option[3:]].extend(strings(values[0] if command[0] == "multi-set" else values))
            elif option == "addignoreip":
                result["ignoreip"].extend(strings(values))
            elif option == "addjournalmatch":
                result["journal_commands"].append(strings(values))
            elif option == "addlogpath" and len(values) in (1, 2):
                # File paths are emitted for the isolated polling fixture. The
                # production contract explicitly requires the systemd backend.
                strings(values)
            elif option == "addaction" and len(values) == 1:
                if values[0] in result["actions"]:
                    raise PolicyError("Duplicate action in command dump")
                result["actions"][values[0]] = {}
            elif option == "action":
                name = values[0]
                if name not in result["actions"]:
                    raise PolicyError("Action properties without an action")
                pairs = values[1] if command[0] == "multi-set" else [values[1:]]
                if not isinstance(pairs, list):
                    raise PolicyError("Unsupported action property dump")
                for pair in pairs:
                    if not isinstance(pair, (list, tuple)) or len(pair) != 2 or not isinstance(pair[0], str):
                        raise PolicyError("Invalid action property")
                    result["actions"][name][pair[0]] = pair[1]
            elif len(values) == 1:
                result[option] = values[0]
            else:
                raise PolicyError("Unsupported jail command dump")
        elif command[0] != "start":
            raise PolicyError("Unsupported jail command dump")
    if not all(key in result for key in ("backend", "maxretry", "findtime", "bantime")):
        raise PolicyError("Incomplete on-disk jail policy")
    if not result["failregex"]:
        raise PolicyError("On-disk jail has no failure expressions")
    result["maxretry"] = integer(result["maxretry"])
    result["maxlines"] = integer(result["maxlines"])
    for key in ("findtime", "bantime"):
        result[key] = seconds(result[key])
    result["ignoreip"] = addresses(result["ignoreip"])
    matches = journal_groups(result.pop("journal_commands"))
    # The server ignores addjournalmatch on FileFilter backends.
    result["journalmatch"] = matches if result["backend"] == "systemd" else []
    return result


def compile_filter(disk):
    # These same public regex classes compile the server's get responses.
    # Constructing them does not start a jail, thread or firewall action.
    from fail2ban.server.failregex import FailRegex, Regex
    options = {"useDns": disk["usedns"], "multiline": disk["maxlines"] > 1}
    prefix = Regex(disk["prefregex"], **options) if disk["prefregex"] else None
    return {
        "prefregex": prefix.getRegex() if prefix else "",
        "failregex": [FailRegex(item, prefRegex=prefix, **options).getRegex() for item in disk["failregex"]],
        "ignoreregex": [Regex(item, **options).getRegex() for item in disk["ignoreregex"]],
    }


def request(send, command):
    if command[0] not in ("status", "get"):
        raise PolicyError("Refusing a mutating socket command")
    response = send(command)
    if not isinstance(response, (list, tuple)) or len(response) != 2 or type(response[0]) is not int:
        raise PolicyError("Unsupported fail2ban socket response")
    if response[0] != 0:
        raise PolicyError("fail2ban read failed: " + " ".join(command))
    return response[1]


def inspect_policy(policy, disk, send, compile_regex=compile_filter):
    """Return drift only after both declared/disk contracts and reads succeed."""
    for key in ("backend", "maxretry", "findtime", "bantime", "ignoreip"):
        if disk[key] != policy[key]:
            raise PolicyError("On-disk policy differs from declared policy: " + key)
    action = policy["action"]
    if set(disk["actions"]) != {action}:
        raise PolicyError("On-disk actions differ from declared policy")
    properties = disk["actions"][action]
    if "port" not in properties or ports(properties["port"]) != policy["ports"]:
        raise PolicyError("On-disk ports differ from declared policy")
    expected_filter = compile_regex(disk)
    stats = request(send, ["status", "--all", "stats"])
    if not isinstance(stats, dict):
        raise PolicyError("Unsupported fail2ban jail statistics")
    if policy["jail"] not in stats:
        return {"matches": False, "differences": ["jail.absent"]}
    state = stats[policy["jail"]]
    if not isinstance(state, (list, tuple)) or len(state) != 3 or not isinstance(state[0], str):
        raise PolicyError("Unsupported fail2ban backend statistics")
    differences = []

    def compare(key, expected, actual):
        if expected != actual:
            differences.append(key)

    def get(key, *extra):
        return request(send, ["get", policy["jail"], key, *extra])

    compare("backend", disk["backend"], state[0])
    for key in ("maxretry", "maxlines"):
        compare(key, disk[key], integer(get(key)))
    for key in ("findtime", "bantime"):
        compare(key, disk[key], seconds(get(key)))
    compare("ignoreip", disk["ignoreip"], addresses(get("ignoreip")))
    compare("usedns", disk["usedns"], get("usedns"))
    compare("ignorecommand", disk["ignorecommand"] or False, get("ignorecommand") or False)
    expected_self = str(disk["ignoreself"]).lower() in ("true", "yes", "1", "on")
    actual_self = get("ignoreself")
    if not isinstance(actual_self, bool):
        raise PolicyError("Unsupported ignoreself response")
    compare("ignoreself", expected_self, actual_self)
    for key in ("prefregex", "failregex", "ignoreregex"):
        value = get(key)
        if key == "prefregex":
            if not isinstance(value, str):
                raise PolicyError("Unsupported prefix expression response")
        else:
            value = strings(value)
        compare(key, expected_filter[key], value)
    compare("journalmatch", disk["journalmatch"], journal_groups(get("journalmatch")))
    live_actions = strings(get("actions"))
    compare("actions", [action], sorted(live_actions))
    if action in live_actions:
        for name, expected in sorted(properties.items()):
            actual = get("action", action, name)
            if name == "port":
                expected, actual = ports(expected), ports(actual)
            compare("action." + name, expected, actual)
    return {"matches": not differences, "differences": differences}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy-json", required=True)
    parser.add_argument("--client", default="/usr/bin/fail2ban-client")
    parser.add_argument("--socket", default="/var/run/fail2ban/fail2ban.sock")
    parser.add_argument("--config", help="Alternative configuration directory for isolated tests")
    args = parser.parse_args(argv)
    connection = None
    try:
        policy = declared_policy(json.loads(args.policy_json))
        command = [args.client] + (["-c", args.config] if args.config else []) + ["-d"]
        dump = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
        if dump.returncode:
            raise PolicyError("Could not read the on-disk fail2ban command dump")
        disk = parse_dump(dump.stdout, policy["jail"])
        from fail2ban.client.csocket import CSocket
        connection = CSocket(args.socket, timeout=10)
        result = inspect_policy(policy, disk, connection.send)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        # fail2ban has its own exception classes (regex/protocol errors). All
        # failed observations are errors, never evidence of recoverable drift.
        print(json.dumps({"matches": False, "differences": [], "error": str(error)}, sort_keys=True))
        return 2
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
