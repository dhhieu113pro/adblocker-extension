from pathlib import Path

path = Path('src/background.ts')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '    const { enabled } = getDnrProtectionPolicy(protectionSettings);\n',
        '    const { enabled, excludedInitiatorDomains } = getDnrProtectionPolicy(protectionSettings);\n',
    ),
    (
        '''      condition: {\n        urlFilter: `||${domain}^`,\n        resourceTypes: DNR_RESOURCE_TYPES,\n      },\n''',
        '''      condition: {\n        urlFilter: `||${domain}^`,\n        resourceTypes: DNR_RESOURCE_TYPES,\n        ...(excludedInitiatorDomains.length > 0 ? { excludedInitiatorDomains } : {}),\n      },\n''',
    ),
    (
        '  if (area === "sync" && changes.autoHideAds) setupDnrRules();\n',
        '  if (area === "sync" && (changes.autoHideAds || changes.disabledSites)) setupDnrRules();\n',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Applied per-site DNR bypass implementation')
