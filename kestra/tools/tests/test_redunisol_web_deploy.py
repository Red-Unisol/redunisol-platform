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

    def test_intake_configuration_reaches_all_app_workers(self):
        compose = yaml.safe_load((ROOT / 'web/redunisol-web/deploy/docker-compose.vps.yml').read_text())
        expected = {
            'EDNA_INTAKE_ENABLED', 'EDNA_INTAKE_CRM_ENABLED', 'EDNA_INTAKE_FLOW_ID',
            'EDNA_INTAKE_START_AT', 'EDNA_INTAKE_PILOT_ID', 'EDNA_INTAKE_RECIPIENTS',
            'KESTRA_EDNA_INTAKE_WEBHOOK_URL',
        }
        for service in ['php-fpm', 'queue-worker', 'edna-worker', 'edna-assistance-worker', 'scheduler']:
            with self.subTest(service=service):
                environment = compose['services'][service]['environment']
                self.assertTrue(expected.issubset(environment), expected.difference(environment))
        self.assertEqual(compose['services']['php-fpm']['environment']['EDNA_INTAKE_ENABLED'], '${EDNA_INTAKE_ENABLED:-false}')

    def test_kestra_runtime_propagates_the_intake_gates(self):
        compose = yaml.safe_load((ROOT / 'kestra/platform/infra/docker-compose.yml').read_text())
        environment = compose['services']['kestra']['environment']
        for key in ['ENV_EDNA_INTAKE_CRM_ENABLED', 'ENV_EDNA_INTAKE_RECIPIENTS', 'ENV_EDNA_INTAKE_FLOW_ID']:
            self.assertIn(key, environment)
        self.assertEqual(environment['ENV_EDNA_INTAKE_CRM_ENABLED'], '${ENV_EDNA_INTAKE_CRM_ENABLED:-false}')

    def test_intake_webhook_invokes_dedicated_processor(self):
        flow = yaml.safe_load((ROOT / 'kestra/automations/marketing-crm/flows/bitrix24_whatsapp_intake.yaml').read_text())
        task = next(task for task in flow['tasks'] if task['id'] == 'procesar')
        self.assertEqual(task['commands'], ['python -m bitrix24_form_flow.kestra_whatsapp_intake_entrypoint'])
        self.assertIn('EDNA_INTAKE_FLOW_ID', task['env'])
        self.assertNotIn('EDNA_ASSISTANCE_FLOW_ID', task['env'])

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
