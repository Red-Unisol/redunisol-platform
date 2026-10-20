"""Contract of the JSON published in Meta, independent of the CRM intake."""

import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[4]
FLOW = json.loads((ROOT / 'docs/whatsapp-jubilados-continuidad.flow.json').read_text(encoding='utf-8'))


def visible_components(nodes, answer):
    for node in nodes:
        if node['type'] == 'If':
            match = re.fullmatch(r"\$\{form\.(\w+)\} == '([^']+)'", node['condition'])
            if not match:
                raise AssertionError('Review new Meta condition syntax before changing this contract')
            branch = 'then' if answer.get(match[1]) == match[2] else 'else'
            yield from visible_components(node.get(branch, []), answer)
        else:
            yield node


class AssistedFlowContractTest(unittest.TestCase):
    def test_help_requires_cuil_but_allows_empty_email_only_in_selected_branch(self):
        components = FLOW['screens'][0]['layout']['children'][0]['children']
        cases = [
            ({'organismo': 'caja_cordoba', 'continuidad_caja': 'ayuda'}, 'caja'),
            ({'organismo': 'anses', 'banco_anses': 'bancor', 'continuidad_anses': 'ayuda'}, 'anses'),
            ({'organismo': 'ayuda'}, 'ayuda'),
            ({'organismo': 'caja_cordoba', 'continuidad_caja': 'formulario'}, None),
            ({'organismo': 'anses', 'banco_anses': 'bancor', 'continuidad_anses': 'formulario'}, None),
            ({'organismo': 'anses', 'banco_anses': 'otro'}, None),
        ]
        for answer, suffix in cases:
            with self.subTest(answer=answer):
                # Stale answers from other branches must not reveal their fields.
                answer = {'continuidad_caja': 'ayuda', 'continuidad_anses': 'ayuda', **answer}
                inputs = {n['name']: n for n in visible_components(components, answer) if n['type'] == 'TextInput'}
                expected = {'cuil_'+suffix, 'email_'+suffix} if suffix else set()
                self.assertEqual(set(inputs), expected)
                if suffix:
                    self.assertTrue(inputs['cuil_'+suffix]['required'])
                    self.assertIsNotNone(re.fullmatch(inputs['cuil_'+suffix]['pattern'], '20301234563'))
                    self.assertIsNone(re.fullmatch(inputs['cuil_'+suffix]['pattern'], '123'))
                    self.assertFalse(inputs['email_'+suffix]['required'])

    def test_completion_keeps_all_existing_payload_names(self):
        footer = FLOW['screens'][0]['layout']['children'][0]['children'][-1]
        self.assertEqual(footer['on-click-action']['name'], 'complete')
        self.assertEqual(set(footer['on-click-action']['payload']), {
            'organismo', 'continuidad_caja', 'cuil_caja', 'email_caja',
            'banco_anses', 'continuidad_anses', 'cuil_anses', 'email_anses',
            'cuil_ayuda', 'email_ayuda',
        })


if __name__ == '__main__':
    unittest.main()
