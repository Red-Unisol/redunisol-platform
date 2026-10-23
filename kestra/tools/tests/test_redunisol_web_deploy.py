from pathlib import Path
import os
import shutil
import subprocess
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]


class RedunisolWebDeployTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        git_bash = Path('C:/Program Files/Git/bin/bash.exe')
        cls.bash = str(git_bash) if os.name == 'nt' and git_bash.exists() else shutil.which('bash')
        if not cls.bash:
            raise unittest.SkipTest('bash unavailable')
        cls.scripts = {}
        for environment in ['dev', 'prod']:
            workflow = yaml.safe_load((ROOT / f'.github/workflows/deploy-redunisol-web-{environment}.yml').read_text())
            job = workflow['jobs'][f'deploy-{environment}']
            script = next(step['run'] for step in job['steps'] if step.get('name') == 'Deploy on VPS')
            cls.scripts[environment] = script.split("<<'EOF'\n", 1)[1].rsplit('\nEOF', 1)[0]

    def shell(self, script):
        # bash -s reproduces SSH's shared script/stdin stream; -c would hide the bug.
        return subprocess.run([self.bash, '-s'], input=script, capture_output=True, text=True, timeout=10)

    def test_remote_scripts_are_valid_bash(self):
        for environment, script in self.scripts.items():
            with self.subTest(environment=environment):
                result = subprocess.run([self.bash, '-n'], input=script, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_attached_commands_cannot_swallow_the_remaining_deploy_script(self):
        mock = 'set -eu\ndocker() { cat > /dev/null; }\n'
        for environment, script in self.scripts.items():
            commands = [line.strip() for line in script.splitlines()
                        if line.strip().startswith('docker compose')
                        and (' run ' in line or ' exec ' in line)]
            self.assertEqual(len(commands), 3)
            for command in commands:
                with self.subTest(environment=environment, command=command):
                    setup = 'compose_project_name=test; staging_dir=/test\n'
                    result = self.shell(mock + setup + command + '\nprintf "DEPLOY_CONTINUES\\n"\n')
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('DEPLOY_CONTINUES', result.stdout)
                    unsafe = command.replace(' < /dev/null', '')
                    reproduction = self.shell(mock + setup + unsafe + '\nprintf "DEPLOY_CONTINUES\\n"\n')
                    self.assertNotIn('DEPLOY_CONTINUES', reproduction.stdout)

    def test_old_or_missing_containers_fail_the_deploy_guard(self):
        for environment, script in self.scripts.items():
            start = script.index('for runtime_service in ')
            end = script.index('if [ "${JOURNEY_ENABLED', start)
            guard = script[start:end]
            workers = 'queue-worker edna-worker scheduler'
            if environment == 'prod':
                workers += ' edna-assistance-worker'
            setup = '''set -eu
compose_project_name=test; staging_dir=/test
APP_IMAGE=app:new; WEB_IMAGE=web:new
docker() {
  local last="${@: -1}"
  if [ "$1" = compose ]; then
    [ "$last" = "$missing" ] || printf 'cid-%s\\n' "$last"
  elif [ "$1" = inspect ]; then
    if [ "$last" = "cid-$stale" ]; then printf 'app:old\\n'
    elif [ "$last" = cid-web ]; then printf 'web:new\\n'
    else printf 'app:new\\n'; fi
  fi
}
'''
            variants = [('', '', True), ('php-fpm', '', False), ('web', '', False),
                        ('scheduler', '', False), ('', 'edna-worker', False)]
            if environment == 'prod':
                variants.append(('edna-assistance-worker', '', False))
            for stale, missing, succeeds in variants:
                with self.subTest(environment=environment, stale=stale, missing=missing):
                    inputs = f'worker_services=({workers}); stale={stale}; missing={missing}\n'
                    result = self.shell(setup + inputs + guard + '\nprintf "IMAGES_VERIFIED\\n"\n')
                    self.assertEqual(result.returncode == 0, succeeds, result.stderr)
                    self.assertEqual('IMAGES_VERIFIED' in result.stdout, succeeds)


if __name__ == '__main__':
    unittest.main()
