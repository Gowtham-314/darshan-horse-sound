import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';

// ── State ──────────────────────────────────────────────────────────────────
let statusBarItem: vscode.StatusBarItem;
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

    // ── Method C: Notebook cell execution result (VS Code 1.75+) ─────────
    //    Fires when any notebook cell (Jupyter, Python, etc.) changes.
    //    Detects TWO failure signals:
    //      1. executionSummary.success === false  → kernel reported failure
    //      2. Error mime type in cell outputs     → traceback/exception output
    context.subscriptions.push(
        vscode.workspace.onDidChangeNotebookDocument(event => {
            if (!isEnabled()) { return; }

            for (const cellChange of event.cellChanges) {
                // Signal 1: execution summary reports failure
                if (cellChange.executionSummary?.success === false) {
                    playSound();
                    return;
                }

                // Signal 2: cell output contains an error item
                if (cellChange.outputs !== undefined) {
                    const hasError = cellChange.cell.outputs.some(output =>
                        output.items.some(item =>
                            item.mime === 'application/vnd.code.notebook.error'
                        )
                    );
                    if (hasError) {
                        playSound();
                        return;
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

    const fp = soundFilePath.replace(/\\/g, '/');

    try {
        if (process.platform === 'win32') {
            // Silent PowerShell — no window, no popup
            const ps =
                `Add-Type -AssemblyName PresentationCore; ` +
                `$m = [System.Windows.Media.MediaPlayer]::new(); ` +
                `$m.Open([System.Uri]::new('${fp}')); ` +
                `$m.Play(); ` +
                `Start-Sleep -Milliseconds 5000`;
            cp.exec(
                `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${ps}"`,
                { windowsHide: true }
            );
        } else if (process.platform === 'darwin') {
            cp.exec(`afplay "${soundFilePath}"`);
        } else {
            cp.exec(
                `paplay "${soundFilePath}" 2>/dev/null || aplay "${soundFilePath}" 2>/dev/null`
            );
        }
    } catch (err) {
        console.error('[Enri-Media Sound Alert] Failed to play sound:', err);
    }
}

// ── Deactivate ─────────────────────────────────────────────────────────────
export function deactivate() {
    statusBarItem?.dispose();
}
