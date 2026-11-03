# Celesol · Vimarx

Public directory edition: focused read-only queries for Mutual Celesol members,
applications, loans and installments. This package is a review draft, not an
approved or published directory release.

The only MCP endpoint for this edition is
`https://mcp.redunisol.com.ar/directorio/mcp`, declared as
`vimarx-celesol-directorio`. Each person connects their own
authorized Vimarx account through OAuth. A connection and its selected account
must remain the same throughout a query, including errors and retries.

Members can be found by name or internal member number. Tools expose only the
fields declared by this directory edition. Generic entity queries, account
movements, document lookup and writes are outside its scope. Do not substitute
another plugin, connection or endpoint to extend this edition's capabilities.

Application lists include only records with an assigned date and may be
truncated. An empty list does not rule out undated applications. A null member
number on an application means that no member is assigned; it must not be
replaced with a guessed identifier.

The included skill explains the eight focused tools and how to handle limits,
missing results and reconnection. A dedicated synthetic DEMO account can be used
for review; its credentials belong only in the portal's private reviewer fields.
DEMO data is fictional and must always be labelled as such.

A verified public walkthrough of this restricted edition is included in the
review metadata. It shows real interactions in a development installation using
fictional DEMO data. Connection and case validation in the submission portal
remain separate; the package is still a review candidate, not an approved release.
