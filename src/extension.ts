import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';

// ── State ──────────────────────────────────────────────────────────────────
let statusBarItem: vscode.StatusBarItem;
let lastSoundTime = 0;
let previousErrorCount = 0;
let soundFilePath = '';

// ── Activate ───────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
    soundFilePath = path.join(context.extensionPath, 'media', 'sound.mp3');

    // Verify sound file exists
    if (!fs.existsSync(soundFilePath)) {
        vscode.window.showWarningMessage(
            '⚠️ Error Sound Alert: sound.mp3 not found in extension media folder.'
        );
    }

    // ── Status Bar Button ──────────────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        1000
    );
    statusBarItem.command = 'errorSoundAlert.toggle';
    refreshStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // ── Commands ───────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('errorSoundAlert.toggle', cmdToggle),
        vscode.commands.registerCommand('errorSoundAlert.test', cmdTest)
    );

    // ── Diagnostics Watcher (Problems Panel / Editor Errors) ───────────────
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(() => {
            const cfg = getConfig();
            if (!cfg.enabled || !cfg.watchDiagnostics) { return; }

            const allDiags = vscode.languages.getDiagnostics();
            let errorCount = 0;
            for (const [, diags] of allDiags) {
                errorCount += diags.filter(
                    d => d.severity === vscode.DiagnosticSeverity.Error
                ).length;
            }

            if (errorCount > previousErrorCount) {
                // New errors appeared — play sound
                playSound(`🔴 ${errorCount - previousErrorCount} new error(s) detected`);
            }
            previousErrorCount = errorCount;
        })
    );

    // ── Terminal Watcher — Layer 1: Shell Exit Codes (VS Code 1.93+) ─────────
    // Best method: catches ANY command that exits with non-zero (errors, crashes)
    try {
        context.subscriptions.push(
            (vscode.window as any).onDidEndTerminalShellExecution(
                (event: { exitCode: number | undefined }) => {
                    const cfg = getConfig();
                    if (!cfg.enabled || !cfg.watchTerminal) { return; }
                    if (event.exitCode !== undefined && event.exitCode !== 0) {
                        playSound(`Terminal: command failed (exit code ${event.exitCode})`);
                    }
                }
            )
        );
    } catch (_) { /* API not available */ }

    // ── Terminal Watcher — Layer 2: Global data stream (VS Code 1.70+) ───────
    // Catches keyword matches across ALL terminals at once
    try {
        context.subscriptions.push(
            (vscode.window as any).onDidWriteTerminalData((event: { data: string }) => {
                const cfg = getConfig();
                if (!cfg.enabled || !cfg.watchTerminal) { return; }
                checkTerminalData(event.data, cfg.terminalKeywords);
            })
        );
    } catch (_) { /* API not available */ }

    // ── Terminal Watcher — Layer 3: Per-terminal listeners ───────────────────
    // Registers on each terminal individually — covers edge cases
    const registerTerminal = (terminal: vscode.Terminal) => {
        try {
            (terminal as any).onDidWriteData?.((data: string) => {
                const cfg = getConfig();
                if (!cfg.enabled || !cfg.watchTerminal) { return; }
                checkTerminalData(data, cfg.terminalKeywords);
            });
        } catch (_) { /* API not available */ }
    };
    // Register on all already-open terminals
    vscode.window.terminals.forEach(registerTerminal);
    // Register on every new terminal opened
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(registerTerminal)
    );

    vscode.window.showInformationMessage(
        '🔊 Error Sound Alert is active! Click the status bar bell to toggle.'
    );
}

// ── Commands ───────────────────────────────────────────────────────────────
function cmdToggle() {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    const current = cfg.get<boolean>('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    refreshStatusBar(!current);
    vscode.window.showInformationMessage(
        !current
            ? '🔊 Error Sound Alert: Enabled'
            : '🔇 Error Sound Alert: Disabled'
    );
}

function cmdTest() {
    vscode.window.showInformationMessage('🔊 Error Sound Alert: Playing test sound...');
    playSound('Test sound', true /* force */);
}

// ── Terminal Data Helper ───────────────────────────────────────────────────
function checkTerminalData(raw: string, keywords: string[]) {
    // Strip ANSI escape codes then lowercase for clean matching
    const data = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').toLowerCase();
    if (keywords.some(kw => data.includes(kw))) {
        playSound('🔴 Error detected in terminal output');
    }
}

// ── Sound Playback ─────────────────────────────────────────────────────────
function playSound(reason: string, force = false) {
    const cfg = getConfig();
    const now = Date.now();

    if (!force && now - lastSoundTime < cfg.cooldownMs) {
        return; // within cooldown window — skip
    }
    lastSoundTime = now;

    console.log(`[ErrorSoundAlert] ${reason}`);

    const fp = soundFilePath.replace(/\\/g, '/');

    try {
        if (process.platform === 'win32') {
            // PowerShell — plays MP3 without opening any visible window
            const ps =
                `Add-Type -AssemblyName PresentationCore; ` +
                `$m = [System.Windows.Media.MediaPlayer]::new(); ` +
                `$m.Open([System.Uri]::new('${fp}')); ` +
                `$m.Play(); ` +
                `Start-Sleep -Milliseconds 4000; ` +
                `$m.Stop()`;
            cp.exec(`powershell -NoProfile -WindowStyle Hidden -Command "${ps}"`, {
                windowsHide: true
            });
        } else if (process.platform === 'darwin') {
            cp.exec(`afplay "${soundFilePath}"`);
        } else {
            // Linux: try paplay (PulseAudio), fall back to aplay
            cp.exec(
                `paplay "${soundFilePath}" 2>/dev/null || aplay "${soundFilePath}" 2>/dev/null`
            );
        }
    } catch (err) {
        console.error('[ErrorSoundAlert] Failed to play sound:', err);
    }
}

// ── Status Bar ─────────────────────────────────────────────────────────────
function refreshStatusBar(enabled?: boolean) {
    const isEnabled =
        enabled !== undefined
            ? enabled
            : vscode.workspace.getConfiguration('errorSoundAlert').get<boolean>('enabled', true);

    statusBarItem.text = isEnabled ? '$(bell) Error Sound' : '$(bell-slash) Error Sound';
    statusBarItem.tooltip = isEnabled
        ? 'Error Sound Alert is ON — click to disable'
        : 'Error Sound Alert is OFF — click to enable';
    statusBarItem.backgroundColor = isEnabled
        ? undefined
        : new vscode.ThemeColor('statusBarItem.warningBackground');
}

// ── Config Helper ──────────────────────────────────────────────────────────
interface Config {
    enabled: boolean;
    watchDiagnostics: boolean;
    watchTerminal: boolean;
    cooldownMs: number;
    terminalKeywords: string[];
}

function getConfig(): Config {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    return {
        enabled:          cfg.get<boolean>('enabled', true),
        watchDiagnostics: cfg.get<boolean>('watchDiagnostics', true),
        watchTerminal:    cfg.get<boolean>('watchTerminal', true),
        cooldownMs:       cfg.get<number>('cooldownMs', 2000),
        terminalKeywords: cfg.get<string[]>('terminalKeywords', ['error:', 'failed'])
    };
}

// ── Deactivate ─────────────────────────────────────────────────────────────
export function deactivate() {
    statusBarItem?.dispose();
}
