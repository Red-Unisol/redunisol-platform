"""Bounded XPO-like subset over fixture dictionaries. No eval, SQL, IO or fallback."""
import re

TOKEN = re.compile(r"\s*(?:(?P<string>'(?:''|[^'])*')|(?P<date>#[0-9T:\-.]+#)|(?P<number>-?\d+(?:\.\d+)?)|(?P<name>[A-Za-z_]\w*)|(?P<op>>=|<=|!=|<>|[=><(),\[\]]))")

class Criteria:
    def __init__(self, text, fields):
        if len(text) > 4096:
            raise ValueError("Criterio DEMO demasiado largo.")
        self.tokens, pos = [], 0
        while pos < len(text):
            if not text[pos:].strip():
                break
            match = TOKEN.match(text, pos)
            if not match:
                raise ValueError("Sintaxis no soportada por el criterio DEMO.")
            self.tokens.append((match.lastgroup, match.group(match.lastgroup)))
            pos = match.end()
        if len(self.tokens) > 256:
            raise ValueError("Criterio DEMO demasiado complejo.")
        self.index, self.fields, self.depth = 0, fields, 0
        self.tree = self.expression() if self.tokens else ("literal", True)
        if self.index != len(self.tokens):
            raise ValueError("Operación no soportada en DEMO.")

    def peek(self, value):
        return self.index < len(self.tokens) and self.tokens[self.index][1].casefold() == value.casefold()

    def take(self, value):
        if not self.peek(value):
            raise ValueError("Criterio DEMO incompleto o no soportado.")
        self.index += 1

    def expression(self):
        node = self.conjunction()
        while self.peek("or"):
            self.take("or"); node = ("or", node, self.conjunction())
        return node

    def conjunction(self):
        node = self.comparison()
        while self.peek("and"):
            self.take("and"); node = ("and", node, self.comparison())
        return node

    def comparison(self):
        self.depth += 1
        if self.depth > 16:
            raise ValueError("Criterio DEMO demasiado anidado.")
        try:
            if self.peek("not"):
                self.take("not"); return ("not", self.comparison())
            if self.peek("("):
                self.take("("); node = self.expression(); self.take(")"); return node
            left = self.scalar()
            if self.peek("in"):
                self.take("in"); self.take("("); values = [self.scalar()]
                while self.peek(","):
                    self.take(","); values.append(self.scalar())
                self.take(")"); return ("in", left, values)
            if self.index < len(self.tokens) and self.tokens[self.index][1] in {"=", "!=", "<>", ">", "<", ">=", "<="}:
                operator = self.tokens[self.index][1]; self.index += 1
                return (operator, left, self.scalar())
            return left
        finally:
            self.depth -= 1

    def scalar(self):
        if self.index == len(self.tokens):
            raise ValueError("Falta un valor en el criterio DEMO.")
        kind, value = self.tokens[self.index]; self.index += 1
        if kind == "string": return ("literal", value[1:-1].replace("''", "'"))
        if kind == "date": return ("literal", value[1:-1])
        if kind == "number": return ("literal", float(value) if "." in value else int(value))
        if value == "[":
            if self.index >= len(self.tokens): raise ValueError("Propiedad DEMO incompleta.")
            value = self.tokens[self.index][1]; self.index += 1; self.take("]")
            kind = "name"
        if kind != "name": raise ValueError("Valor DEMO no soportado.")
        if value.casefold() in {"true", "false", "null"}:
            return ("literal", {"true": True, "false": False, "null": None}[value.casefold()])
        if value.casefold() in {"contains", "startswith", "endswith"}:
            self.take("("); field = self.scalar(); self.take(","); pattern = self.scalar(); self.take(")")
            return (value.casefold(), field, pattern)
        if value not in self.fields: raise ValueError("Propiedad no disponible en DEMO: " + value)
        return ("field", value)

    def matches(self, row):
        def evaluate(node):
            op = node[0]
            if op == "literal": return node[1]
            if op == "field": return row[node[1]]
            if op == "not": return not evaluate(node[1])
            if op == "and": return bool(evaluate(node[1]) and evaluate(node[2]))
            if op == "or": return bool(evaluate(node[1]) or evaluate(node[2]))
            a = evaluate(node[1])
            if op == "in": return a in [evaluate(n) for n in node[2]]
            b = evaluate(node[2])
            if op == "contains": return str(b).casefold() in str(a).casefold()
            if op == "startswith": return str(a).casefold().startswith(str(b).casefold())
            if op == "endswith": return str(a).casefold().endswith(str(b).casefold())
            if op == "=": return a == b
            if op in {"!=", "<>"}: return a != b
            if a is None or b is None: return False
            if op == ">": return a > b
            if op == "<": return a < b
            if op == ">=": return a >= b
            if op == "<=": return a <= b
            raise ValueError("Operación DEMO no soportada.")
        return bool(evaluate(self.tree))

def field_list(text, fields):
    names = [name.strip().strip("[]") for name in text.split(",") if name.strip()]
    if not set(names).issubset(fields):
        raise ValueError("Proyección o agrupación no soportada en DEMO.")
    return names

def query(records, fields, arguments):
    predicate = Criteria(arguments.get("criteria", ""), fields)
    result = [row for row in records if predicate.matches(row)]
    projection = arguments.get("propiedades", "")
    aggregate = re.fullmatch(r"\s*(Count|Sum|Avg|Min|Max)\((\w*)\)(?:\s+as\s+(\w+))?\s*", projection, re.I)
    group = field_list(arguments.get("agruparPor", ""), fields)
    if aggregate:
        operation, field, alias = aggregate.groups()
        if operation.casefold() != "count" and field not in fields: raise ValueError("Agregado DEMO inválido.")
        if operation.casefold() == "count" and field: raise ValueError("Usar Count() en DEMO.")
        buckets = {}
        for row in result:
            buckets.setdefault(tuple(row[n] for n in group), []).append(row)
        if not result and not group: buckets[()] = []
        result = []
        for key, rows in buckets.items():
            values = [r[field] for r in rows] if field else []
            op = operation.casefold()
            if op in {"sum", "avg"} and any(type(v) not in (int, float) for v in values):
                raise ValueError("El agregado DEMO requiere números.")
            if op == "count": value = len(rows)
            elif not values: value = None
            elif op == "sum": value = sum(values)
            elif op == "avg": value = sum(values) / len(values)
            elif op == "min": value = min(values)
            else: value = max(values)
            result.append(dict(zip(group, key), **{alias or operation: value}))
        output_fields = set(group) | {alias or operation}
    else:
        if group: raise ValueError("Agrupar requiere un único agregado en DEMO.")
        selected = field_list(projection, fields) if projection else sorted(fields)
        result = [{n: row[n] for n in selected} for row in result]
        output_fields = set(selected)
    sorting = arguments.get("ordenarPor", "")
    for part in reversed(sorting.split(",") if sorting.strip() else []):
        match = re.fullmatch(r"\s*\[?(\w+)\]?\s*(ASC|DESC)?\s*", part, re.I)
        if not match or match[1] not in output_fields:
            raise ValueError("Ordenamiento no soportado en DEMO; incluir el campo en propiedades.")
        name, direction = match.groups()
        result.sort(key=lambda r: (r[name] is None, r[name]), reverse=(direction or "ASC").upper() == "DESC")
    return result[:arguments.get("limit", 50)]
