from pathlib import Path

path = Path('src/content.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '    this.adCheckUrls = new Set();\n    this.scanTimer = null;\n',
        '    this.adCheckUrls = new Set();\n    this.protectionGeneration = 0;\n    this.scanTimer = null;\n',
    ),
    (
        '  disableSiteBlocking() {\n    document.querySelectorAll(\'[data-webllm-ad-hidden="true"]\').forEach((element) => this.unhideElement(element));\n',
        '  disableSiteBlocking() {\n    this.protectionGeneration += 1;\n    document.querySelectorAll(\'[data-webllm-ad-hidden="true"]\').forEach((element) => this.unhideElement(element));\n',
    ),
    (
        '      const { img, msg } = this.adCheckQueue.shift();\n      if (!img?.isConnected) continue;\n      const imageDataUrl = await this.fetchImageDataUrl(msg.imageUrl);\n',
        '      const { img, msg } = this.adCheckQueue.shift();\n      const generation = this.protectionGeneration;\n      if (!img?.isConnected) continue;\n      const imageDataUrl = await this.fetchImageDataUrl(msg.imageUrl);\n',
    ),
    (
        '          if (res?.isAd && res.confidence >= 50 && img?.isConnected) { this.hideAd(img, res); this.cleanupEmptyAdContainers(); }\n',
        '          if (generation === this.protectionGeneration && this.autoHideAds && !this.siteDisabled && res?.isAd && res.confidence >= 50 && img?.isConnected) { this.hideAd(img, res); this.cleanupEmptyAdContainers(); }\n',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match, found {count}: {old!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Applied in-flight bypass fix')
