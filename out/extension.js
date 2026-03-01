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
let previousErrorCount = 0;
let soundFilePath = '';
// ── Activate ───────────────────────────────────────────────────────────────
function activate(context) {
    soundFilePath = path.join(context.extensionPath, 'media', 'sound.mp3');
    // Verify sound file exists
    if (!fs.existsSync(soundFilePath)) {
        vscode.window.showWarningMessage('⚠️ Error Sound Alert: sound.mp3 not found in extension media folder.');
    }
    // ── Status Bar Button ──────────────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    statusBarItem.command = 'errorSoundAlert.toggle';
    refreshStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // ── Commands ───────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('errorSoundAlert.toggle', cmdToggle), vscode.commands.registerCommand('errorSoundAlert.test', cmdTest));
    // ── Diagnostics Watcher (Problems Panel / Editor Errors) ───────────────
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => {
        const cfg = getConfig();
        if (!cfg.enabled || !cfg.watchDiagnostics) {
            return;
        }
        const allDiags = vscode.languages.getDiagnostics();
        let errorCount = 0;
        for (const [, diags] of allDiags) {
            errorCount += diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
        }
        if (errorCount > previousErrorCount) {
            // New errors appeared — play sound
            playSound(`🔴 ${errorCount - previousErrorCount} new error(s) detected`);
        }
        previousErrorCount = errorCount;
    }));
    // ── Terminal Watcher — Layer 1: Shell Exit Codes (VS Code 1.93+) ─────────
    // Best method: catches ANY command that exits with non-zero (errors, crashes)
    try {
        context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution((event) => {
            const cfg = getConfig();
            if (!cfg.enabled || !cfg.watchTerminal) {
                return;
            }
            if (event.exitCode !== undefined && event.exitCode !== 0) {
                playSound(`Terminal: command failed (exit code ${event.exitCode})`);
            }
        }));
    }
    catch (_) { /* API not available */ }
    // ── Terminal Watcher — Layer 2: Global data stream (VS Code 1.70+) ───────
    // Catches keyword matches across ALL terminals at once
    try {
        context.subscriptions.push(vscode.window.onDidWriteTerminalData((event) => {
            const cfg = getConfig();
            if (!cfg.enabled || !cfg.watchTerminal) {
                return;
            }
            checkTerminalData(event.data, cfg.terminalKeywords);
        }));
    }
    catch (_) { /* API not available */ }
    // ── Terminal Watcher — Layer 3: Per-terminal listeners ───────────────────
    // Registers on each terminal individually — covers edge cases
    const registerTerminal = (terminal) => {
        try {
            terminal.onDidWriteData?.((data) => {
                const cfg = getConfig();
                if (!cfg.enabled || !cfg.watchTerminal) {
                    return;
                }
                checkTerminalData(data, cfg.terminalKeywords);
            });
        }
        catch (_) { /* API not available */ }
    };
    // Register on all already-open terminals
    vscode.window.terminals.forEach(registerTerminal);
    // Register on every new terminal opened
    context.subscriptions.push(vscode.window.onDidOpenTerminal(registerTerminal));
    vscode.window.showInformationMessage('🔊 Error Sound Alert is active! Click the status bar bell to toggle.');
}
// ── Commands ───────────────────────────────────────────────────────────────
function cmdToggle() {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    const current = cfg.get('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
    refreshStatusBar(!current);
    vscode.window.showInformationMessage(!current
        ? '🔊 Error Sound Alert: Enabled'
        : '🔇 Error Sound Alert: Disabled');
}
function cmdTest() {
    vscode.window.showInformationMessage('🔊 Error Sound Alert: Playing test sound...');
    playSound('Test sound', true /* force */);
}
// ── Terminal Data Helper ───────────────────────────────────────────────────
function checkTerminalData(raw, keywords) {
    // Strip ANSI escape codes then lowercase for clean matching
    const data = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').toLowerCase();
    if (keywords.some(kw => data.includes(kw))) {
        playSound('🔴 Error detected in terminal output');
    }
}
// ── Sound Playback ─────────────────────────────────────────────────────────
function playSound(reason, force = false) {
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
            const ps = `Add-Type -AssemblyName PresentationCore; ` +
                `$m = [System.Windows.Media.MediaPlayer]::new(); ` +
                `$m.Open([System.Uri]::new('${fp}')); ` +
                `$m.Play(); ` +
                `Start-Sleep -Milliseconds 4000; ` +
                `$m.Stop()`;
            cp.exec(`powershell -NoProfile -WindowStyle Hidden -Command "${ps}"`, {
                windowsHide: true
            });
        }
        else if (process.platform === 'darwin') {
            cp.exec(`afplay "${soundFilePath}"`);
        }
        else {
            // Linux: try paplay (PulseAudio), fall back to aplay
            cp.exec(`paplay "${soundFilePath}" 2>/dev/null || aplay "${soundFilePath}" 2>/dev/null`);
        }
    }
    catch (err) {
        console.error('[ErrorSoundAlert] Failed to play sound:', err);
    }
}
// ── Status Bar ─────────────────────────────────────────────────────────────
function refreshStatusBar(enabled) {
    const isEnabled = enabled !== undefined
        ? enabled
        : vscode.workspace.getConfiguration('errorSoundAlert').get('enabled', true);
    statusBarItem.text = isEnabled ? '$(bell) Error Sound' : '$(bell-slash) Error Sound';
    statusBarItem.tooltip = isEnabled
        ? 'Error Sound Alert is ON — click to disable'
        : 'Error Sound Alert is OFF — click to enable';
    statusBarItem.backgroundColor = isEnabled
        ? undefined
        : new vscode.ThemeColor('statusBarItem.warningBackground');
}
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('errorSoundAlert');
    return {
        enabled: cfg.get('enabled', true),
        watchDiagnostics: cfg.get('watchDiagnostics', true),
        watchTerminal: cfg.get('watchTerminal', true),
        cooldownMs: cfg.get('cooldownMs', 2000),
        terminalKeywords: cfg.get('terminalKeywords', ['error:', 'failed'])
    };
}
// ── Deactivate ─────────────────────────────────────────────────────────────
function deactivate() {
    statusBarItem?.dispose();
}
//# sourceMappingURL=extension.js.map