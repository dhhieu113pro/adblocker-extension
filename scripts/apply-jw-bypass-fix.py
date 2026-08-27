from pathlib import Path

path = Path('src/content.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '  disableSiteBlocking() {\n    this.protectionGeneration += 1;\n',
        '  disableSiteBlocking() {\n    this.protectionGeneration += 1;\n    this.restoreJwMutedVideos();\n',
    ),
    (
        '  setupJwAdSkipAutomation() {\n',
        '  restoreJwMutedVideos() {\n    this.jwMutedVideos.forEach((state, video) => {\n      if (!video.isConnected) return;\n      video.muted = state.muted;\n      video.volume = state.volume;\n    });\n    this.jwMutedVideos.clear();\n  }\n\n  setupJwAdSkipAutomation() {\n',
    ),
    (
        '    window.setTimeout(() => {\n      this.jwMutedVideos.forEach((state, video) => {\n        if (!video.isConnected) return;\n        video.muted = state.muted;\n        video.volume = state.volume;\n      });\n      this.jwMutedVideos.clear();\n    }, 150);\n',
        '    window.setTimeout(() => this.restoreJwMutedVideos(), 150);\n',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match, found {count}: {old!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Applied JW bypass fix')
