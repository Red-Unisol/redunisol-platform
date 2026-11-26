"""Public Bitrix rejection-robot copy that a CRM user posts in the sales chat.

The Bitrix rejection robot writes its notice with the provisional user (57), so
Bitrix counts it as an operator message. It is automated copy, not attention.
Only the exact catalog text (same normalization as the web catalog,
``web/redunisol-web/resources/crm/rejection-notices.json``) is recognized; a test
keeps both in sync.
"""
from hashlib import sha256

NORMALIZATION = "crlf-to-lf-ascii-edge-space-v1"
ROBOT_SENDER_ID = 57

# normalized_sha256 of each notice (Bitrix template ids in the web catalog).
# 691 and 695 share the same copy.
NOTICE_SHA256 = frozenset({
    "61aaa6468050cc715a48a3a5bc3336a24e2536680d26d55f103cea4f540547e9",  # 707 SIT NEG BCRA
    "1fd9971ceb93400076352612f492714ceedd412eba70a6421ce38ecce5cae999",  # 383 OTRO BANCO
    "dd45e1c6baa98bcff003ee655728ea73099b5c9c8bad27fe7e232e452df7f371",  # 385 NO TIENE ANTIGUEDAD
    "b675021343ada8ee562c854b4b3e2201016e441713b1875c34c8cc0a15c135c2",  # 387 AUTONOMO
    "50852cb40f150eaaa6cfdf1d460b6d1e05e951c25f60393b1c67655601d03966",  # 389 AUH
    "29931fc0cf664b4ae523a9b8d89cc17eceea3cad2cd84bef317a3f16a51cbbc9",  # 691/695 JUBILADO
    "43a70219ae099985c1b6055c750d8bc96a86e2d32273dddd5679af281566435b",  # 689 PENSIONADO
    "1b227e640886a044a471b62069feb4827bf4ca4c52425f03cedd00f3d7e4a486",  # 693 PUBLICO NACIONAL
    "0da6bb420e11eb764af8595dc26fd4aeb69decb2bb177685bd1db67d1f49285f",  # 391 NO TIENE RECIBO
    "2d86cc1e472a4af7303c46eec6dce85f12fe5ff67d314c3dcbf6b15620f88bcd",  # 393 CONTRATADO
    "00c8a58cf26d3bd7bdab515596acb4bc312c0c085af8c7ed9f88aac7cd7cf3bb",  # 397 PRIVADOS
    "f67ec9b31349e2c9715b65aa3ed9cf868962f8d79c05c2aa18b2a6eb99b94b55",  # 399 MUNICIPAL
    "102a4ae66bae8e917cbcf94f20bf2f64d74f00796cba72abb9087a06d425f49a",  # 407 NO CUMPLE REQUISITOS
})


def normalize(text):
    if not isinstance(text, str) or len(text) > 20000:
        return None
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip(" \t\n")
    if not text or "{=" in text or "{{" in text or "${" in text:
        return None
    return text


def is_rejection_notice(sender_id, text):
    """True only for the robot sender posting an exact catalog notice."""
    normalized = normalize(text)
    return (sender_id == ROBOT_SENDER_ID and normalized is not None
            and sha256(normalized.encode("utf-8")).hexdigest() in NOTICE_SHA256)
