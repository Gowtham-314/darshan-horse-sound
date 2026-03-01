"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
// ── State ──────────────────────────────────────────────────────────────────
let statusBarItem;
let lastSoundTime = 0;
let soundFilePath = '';
// ── Activate ───────────────────────────────────────────────────────────────
function activate(context) {
    soundFilePath = path.join(context.extensionPath, 'media', 'sound.mp3');
    if (!fs.existsSync(soundFilePath)) {
        vscode.window.showWarningMessage('⚠️ Enri-Media Sound Alert: sound.mp3 not found in extension media folder.');
    }
    // ── Status Bar ─────────────────────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    statusBarItem.command = 'errorSoundAlert.toggle';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // ── Commands ───────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('errorSoundAlert.toggle', cmdToggle), vscode.commands.registerCommand('errorSoundAlert.test', cmdTest));
    // ══════════════════════════════════════════════════════════════════════
    //  TERMINAL ERROR DETECTION — exit code only, never while typing
    // ══════════════════════════════════════════════════════════════════════
    // ── Method A: Per-command exit code (VS Code 1.93+ shell integration) ─
    //    Fires after EVERY individual command run inside the terminal.
    //    Supports: Python, Node.js, Java, C/C++, any compiled output, etc.
    //    This is the most precise method — only fires when a command fails.
    try {
        const onEnd = vscode.window.onDidEndTerminalShellExecution;
        if (typeof onEnd === 'function') {
            context.subscriptions.push(onEnd((event) => {
                if (!isEnabled()) {
                    return;
                }
                if (event.exitCode !== undefined && event.exitCode !== 0) {
                    playSound();
                }
            }));
        }
    }
    catch (_) { /* shell integration not available */ }
    // ── Method B: Terminal process exit (all VS Code versions) ────────────
    //    Fires when the terminal PROCESS itself exits with a failure code.
    //    Useful when running scripts that exit the whole terminal on error
    //    (e.g., running a compiled binary that crashes).
    context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
        if (!isEnabled()) {
            return;
        }
        const code = terminal.exitStatus?.code;
        if (code !== undefined && code !== 0) {
            playSound();
        }
    }));
    // ══════════════════════════════════════════════════════════════════════
    //  JUPYTER NOTEBOOK DETECTION — kernel cell execution errors
    // ══════════════════════════════════════════════════════════════════════
    // ── Method C: Notebook cell execution result (VS Code 1.75+) ─────────
    //    Fires when any notebook cell (Jupyter, Python, etc.) changes.
    //    Detects TWO failure signals:
    //      1. executionSummary.success === false  → kernel reported failure
    //      2. Error mime type in cell outputs     → traceback/exception output
    context.subscriptions.push(vscode.workspace.onDidChangeNotebookDocument(event => {
        if (!isEnabled()) {
            return;
        }
        for (const cellChange of event.cellChanges) {
            // Signal 1: execution summary reports failure
            if (cellChange.executionSummary?.success === false) {
                playSound();
                return;
            }
            // Signal 2: cell output contains an error item
            if (cellChange.outputs !== undefined) {
                const hasError = cellChange.cell.outputs.some(output => output.items.some(item => item.mime === 'application/vnd.code.notebook.error'));
                if (hasError) {
                    playSound();
                    return;
                }
            }
        }
    }));
    vscode.window.showInformationMessage('🔊 Enri-Media Sound Alert active — plays sound when your code crashes!');
}
// ── Commands ───────────────────────────────────────────────────────────────
function cmdToggle() {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    const current = cfg.get('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    updateStatusBar(!current);
    vscode.window.showInformationMessage(!current
        ? '🔊 Enri-Media Sound Alert: Enabled'
        : '🔇 Enri-Media Sound Alert: Disabled');
}
function cmdTest() {
    vscode.window.showInformationMessage('🔊 Playing test sound...');
    playSound(true);
}
// ── Helpers ────────────────────────────────────────────────────────────────
function isEnabled() {
    return vscode.workspace
        .getConfiguration('errorSoundAlert')
        .get('enabled', true);
}
function updateStatusBar(enabled) {
    const on = enabled !== undefined ? enabled : isEnabled();
    statusBarItem.text = on ? '$(bell) Error Sound' : '$(bell-slash) Error Sound';
    statusBarItem.tooltip = on
        ? 'Enri-Media Sound Alert: ON — click to disable'
        : 'Enri-Media Sound Alert: OFF — click to enable';
    statusBarItem.backgroundColor = on
        ? undefined
        : new vscode.ThemeColor('statusBarItem.warningBackground');
}
// ── Sound Playback ─────────────────────────────────────────────────────────
function playSound(force = false) {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    const delay = cfg.get('cooldownMs', 2000);
    const now = Date.now();
    if (!force && now - lastSoundTime < delay) {
        return;
    }
    lastSoundTime = now;
    // ── Visual flash on status bar so user knows detection fired ──────────
    const original = statusBarItem.text;
    const originalBg = statusBarItem.backgroundColor;
    statusBarItem.text = '$(bell-dot) ERROR!';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    setTimeout(() => {
        statusBarItem.text = original;
        statusBarItem.backgroundColor = originalBg;
    }, 2500);
    // ── Audio Playback ────────────────────────────────────────────────────
    const winPath = soundFilePath.replace(/\//g, '\\');
    const unixPath = soundFilePath.replace(/\\/g, '/');
    try {
        if (process.platform === 'win32') {
            // Method 1: WMPlayer COM object — most reliable for MP3 on Windows
            // Works from any process without needing a WPF Dispatcher
            const ps1 = `$wmp = New-Object -ComObject 'WMPlayer.OCX.7'; ` +
                `$wmp.settings.volume = 100; ` +
                `$wmp.URL = '${winPath}'; ` +
                `$wmp.controls.play(); ` +
                `Start-Sleep -Seconds 5; ` +
                `$wmp.controls.stop()`;
            cp.exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${ps1}"`, { windowsHide: true }, (err) => {
                if (err) {
                    // Method 2 fallback: MediaPlayer with Dispatcher pump
                    const ps2 = `Add-Type -AssemblyName PresentationCore; ` +
                        `$d = [System.Windows.Threading.Dispatcher]::CurrentDispatcher; ` +
                        `$m = New-Object System.Windows.Media.MediaPlayer; ` +
                        `$m.Open([uri]'file:///${unixPath}'); ` +
                        `$m.Play(); ` +
                        `Start-Sleep -Seconds 5`;
                    cp.exec(`powershell -NoProfile -WindowStyle Hidden -Command "${ps2}"`, { windowsHide: true });
                }
            });
        }
        else if (process.platform === 'darwin') {
            cp.exec(`afplay "${soundFilePath}"`);
        }
        else {
            cp.exec(`paplay "${soundFilePath}" 2>/dev/null || aplay "${soundFilePath}" 2>/dev/null`);
        }
    }
    catch (err) {
        console.error('[Enri-Media Sound Alert] Playback error:', err);
    }
}
// ── Deactivate ─────────────────────────────────────────────────────────────
function deactivate() {
    statusBarItem?.dispose();
}
//# sourceMappingURL=extension.js.map