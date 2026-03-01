# 🔊 Error Sound Alert

A VS Code extension that plays a sound whenever an error occurs — in the **editor (Problems panel)**, **terminal**, or **PowerShell**.

---

## Features

| Feature                  | Details                                                         |
| ------------------------ | --------------------------------------------------------------- |
| 🔴 **Editor Errors**     | Plays sound when new errors appear in the Problems panel        |
| 🖥️ **Terminal Errors**   | Plays sound when error keywords appear in terminal output       |
| 🔔 **Status Bar Toggle** | Click `$(bell) Error Sound` in the status bar to enable/disable |
| ⏱️ **Cooldown**          | Configurable delay (default 2s) to prevent sound spam           |
| ▶️ **Test Command**      | `Ctrl+Shift+P` → `Error Sound Alert: Test Sound 🔊`             |

---

## Settings

Open **Settings** (`Ctrl+,`) and search for `Error Sound Alert`:

| Setting                            | Default      | Description                  |
| ---------------------------------- | ------------ | ---------------------------- |
| `errorSoundAlert.enabled`          | `true`       | Enable/disable the extension |
| `errorSoundAlert.watchDiagnostics` | `true`       | Watch Problems panel         |
| `errorSoundAlert.watchTerminal`    | `true`       | Watch terminal output        |
| `errorSoundAlert.cooldownMs`       | `2000`       | Min ms between sounds        |
| `errorSoundAlert.terminalKeywords` | _(see list)_ | Keywords that trigger sound  |

---

## How to Run (Development)

```bash
npm install
npm run compile
# Then press F5 in VS Code to launch the Extension Development Host
```

---

## Sound File

The sound file is located at `media/sound.mp3`. Replace it with any MP3 of your choice.
