import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';

// ── State ──────────────────────────────────────────────────────────────────
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let lastSoundTime = 0;
let soundFilePath = '';

// ── Activate ───────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
    soundFilePath = path.join(context.extensionPath, 'media', 'sound.mp3');

    if (!fs.existsSync(soundFilePath)) {
        vscode.window.showWarningMessage(
            '⚠️ Enri-Media Sound Alert: sound.mp3 not found in extension media folder.'
        );
    }

    // Output channel for debugging (View → Output → Enri-Media Sound Alert)
    outputChannel = vscode.window.createOutputChannel('Enri-Media Sound Alert');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('Extension activated ✅');

    // ── Status Bar ─────────────────────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 1000
    );
    statusBarItem.command = 'errorSoundAlert.toggle';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // ── Commands ───────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('errorSoundAlert.toggle', cmdToggle),
        vscode.commands.registerCommand('errorSoundAlert.test',   cmdTest)
    );

    // ══════════════════════════════════════════════════════════════════════
    //  TERMINAL ERROR DETECTION — exit code only, never while typing
    // ══════════════════════════════════════════════════════════════════════

    // ── Method A: Per-command exit code (VS Code 1.93+ shell integration) ─
    //    Fires after EVERY individual command run inside the terminal.
    //    Supports: Python, Node.js, Java, C/C++, any compiled output, etc.
    //    This is the most precise method — only fires when a command fails.
    try {
        const onEnd = (vscode.window as any).onDidEndTerminalShellExecution;
        if (typeof onEnd === 'function') {
            context.subscriptions.push(
                onEnd((event: { exitCode: number | undefined }) => {
                    if (!isEnabled()) { return; }
                    if (event.exitCode !== undefined && event.exitCode !== 0) {
                        playSound();
                    }
                })
            );
        }
    } catch (_) { /* shell integration not available */ }

    // ── Method B: Terminal process exit (all VS Code versions) ────────────
    //    Fires when the terminal PROCESS itself exits with a failure code.
    //    Useful when running scripts that exit the whole terminal on error
    //    (e.g., running a compiled binary that crashes).
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(terminal => {
            if (!isEnabled()) { return; }
            const code = terminal.exitStatus?.code;
            if (code !== undefined && code !== 0) {
                playSound();
            }
        })
    );

    // ══════════════════════════════════════════════════════════════════════
    //  JUPYTER NOTEBOOK DETECTION — kernel cell execution errors
    // ══════════════════════════════════════════════════════════════════════
    context.subscriptions.push(
        vscode.workspace.onDidChangeNotebookDocument(event => {
            if (!isEnabled()) { return; }
            outputChannel.appendLine(`Notebook change detected in: ${event.notebook.uri.fsPath}`);

            for (const cellChange of event.cellChanges) {
                // Signal 1: execution summary explicitly reports failure
                const summary = cellChange.executionSummary;
                outputChannel.appendLine(`  executionSummary.success = ${summary?.success}`);
                if (summary?.success === false) {
                    outputChannel.appendLine('  ▶ ERROR via executionSummary.success === false');
                    playSound();
                    return;
                }

                // Signal 2: the CHANGED outputs (delta) contain an error mime type
                //   Use cellChange.outputs (what changed), not cellChange.cell.outputs (full array)
                const changedOutputs = cellChange.outputs;
                if (changedOutputs && changedOutputs.length > 0) {
                    for (const output of changedOutputs) {
                        for (const item of output.items) {
                            outputChannel.appendLine(`  output item mime: ${item.mime}`);
                            if (item.mime === 'application/vnd.code.notebook.error') {
                                outputChannel.appendLine('  ▶ ERROR via notebook error mime type');
                                playSound();
                                return;
                            }
                        }
                    }
                }
            }
        })
    );

    vscode.window.showInformationMessage(
        '🔊 Enri-Media Sound Alert active — plays sound when your code crashes!'
    );
}

// ── Commands ───────────────────────────────────────────────────────────────
function cmdToggle() {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    const current = cfg.get<boolean>('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    updateStatusBar(!current);
    vscode.window.showInformationMessage(
        !current
            ? '🔊 Enri-Media Sound Alert: Enabled'
            : '🔇 Enri-Media Sound Alert: Disabled'
    );
}

function cmdTest() {
    vscode.window.showInformationMessage('🔊 Playing test sound...');
    playSound(true);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('errorSoundAlert')
        .get<boolean>('enabled', true);
}

function updateStatusBar(enabled?: boolean) {
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
    const cfg   = vscode.workspace.getConfiguration('errorSoundAlert');
    const delay = cfg.get<number>('cooldownMs', 2000);
    const now   = Date.now();

    if (!force && now - lastSoundTime < delay) { return; }
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
            const ps1 =
                `$wmp = New-Object -ComObject 'WMPlayer.OCX.7'; ` +
                `$wmp.settings.volume = 100; ` +
                `$wmp.URL = '${winPath}'; ` +
                `$wmp.controls.play(); ` +
                `Start-Sleep -Seconds 5; ` +
                `$wmp.controls.stop()`;

            cp.exec(
                `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${ps1}"`,
                { windowsHide: true },
                (err) => {
                    if (err) {
                        // Method 2 fallback: MediaPlayer with Dispatcher pump
                        const ps2 =
                            `Add-Type -AssemblyName PresentationCore; ` +
                            `$d = [System.Windows.Threading.Dispatcher]::CurrentDispatcher; ` +
                            `$m = New-Object System.Windows.Media.MediaPlayer; ` +
                            `$m.Open([uri]'file:///${unixPath}'); ` +
                            `$m.Play(); ` +
                            `Start-Sleep -Seconds 5`;
                        cp.exec(
                            `powershell -NoProfile -WindowStyle Hidden -Command "${ps2}"`,
                            { windowsHide: true }
                        );
                    }
                }
            );
        } else if (process.platform === 'darwin') {
            cp.exec(`afplay "${soundFilePath}"`);
        } else {
            cp.exec(
                `paplay "${soundFilePath}" 2>/dev/null || aplay "${soundFilePath}" 2>/dev/null`
            );
        }
    } catch (err) {
        console.error('[Enri-Media Sound Alert] Playback error:', err);
    }
}

// ── Deactivate ─────────────────────────────────────────────────────────────
export function deactivate() {
    statusBarItem?.dispose();
}
