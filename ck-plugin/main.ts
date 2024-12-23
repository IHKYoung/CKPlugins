import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

/**
 * 插件的设置接口
 */
interface AutoConvertCharsPluginSettings {
    autoConvertDelay: number; // 自动转换的延迟时间（毫秒）
}

/**
 * 插件的默认设置
 */
const DEFAULT_SETTINGS: AutoConvertCharsPluginSettings = {
    autoConvertDelay: 100
};

/**
 * 判断指定行是否在代码块内
 * @param lines 所有行内容
 * @param lineNumber 当前行号（从0开始）
 * @returns 是否在代码块内
 */
function isLineInCodeBlock(lines: string[], lineNumber: number): boolean {
    let inCodeBlock = false;
    let codeBlockDelimiter = '';

    for (let i = 0; i <= lineNumber; i++) {
        const line = lines[i];
        const codeBlockMatch = line.match(/^(```|~~~)/);
        if (codeBlockMatch) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockDelimiter = codeBlockMatch[1];
            } else if (codeBlockMatch[1] === codeBlockDelimiter) {
                inCodeBlock = false;
                codeBlockDelimiter = '';
            }
        }
    }

    return inCodeBlock;
}

/**
 * 替换单行中的特定字符组合为目标符号，忽略行内代码中的匹配
 * @param line 原始行内容
 * @returns 替换后的行内容及是否进行了替换
 */
function replacePatternsInLine(line: string): { newLine: string; replaced: boolean } {
    // **重要**：将更长的触发字符组合放在前面，避免部分匹配
    const patterns = [
        { trigger: '··· ', replacement: '``````' }, // 六个反引号
        { trigger: '· ', replacement: '``' },        // 两个反引号
        { trigger: '》 ', replacement: '>' },        // 引用符号
        { trigger: '〉 ', replacement: '>' }         // 引用符号
    ];

    let inInlineCode = false;
    let result = '';
    let replaced = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        // 处理行内代码的切换
        if (char === '`') {
            inInlineCode = !inInlineCode;
            result += char;
            continue;
        }

        if (!inInlineCode) {
            let matched = false;
            for (const pattern of patterns) {
                const triggerLength = pattern.trigger.length;
                const triggerSubstring = line.substring(i, i + triggerLength);
                if (triggerSubstring === pattern.trigger) {
                    result += pattern.replacement;
                    i += triggerLength - 1; // 跳过触发字符
                    replaced = true;
                    matched = true;
                    break; // 跳出当前循环，继续下一个字符
                }
            }

            if (matched) {
                continue; // 已经替换，跳过添加当前字符
            }
        }

        result += char;
    }

    return { newLine: result, replaced };
}

/**
 * 简单的防抖函数实现
 * @param func 需要防抖的函数
 * @param wait 防抖的时间间隔（毫秒）
 * @returns 防抖后的函数
 */
function debounceFunc(func: () => void, wait: number) {
    let timeout: number | undefined;
    return () => {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
        timeout = window.setTimeout(() => {
            func();
        }, wait);
    };
}

export default class AutoConvertCharsPlugin extends Plugin {
    settings: AutoConvertCharsPluginSettings;
    private onEditHandler: () => void;

    /**
     * 加载插件时的初始化逻辑
     */
    async onload() {
        await this.loadSettings();

        // 创建防抖后的编辑器变化处理函数
        this.onEditHandler = debounceFunc(() => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const editor = activeView.editor;
                this.convertPatterns(editor);
            }
        }, this.settings.autoConvertDelay);

        // 注册编辑器变化事件
        this.registerEvent(this.app.workspace.on('editor-change', this.onEditHandler));

        // 添加设置选项卡
        this.addSettingTab(new AutoConvertCharsSettingTab(this.app, this));
    }

    /**
     * 卸载插件时的清理逻辑
     */
    onunload() {
        console.log('Auto Convert Chars Plugin Unloaded.');
    }

    /**
     * 加载插件设置
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * 保存插件设置
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 更新自动转换延迟时间
     * @param newDelay 新的延迟时间（毫秒）
     */
    public updateAutoConvertDelay(newDelay: number) {
        this.settings.autoConvertDelay = newDelay;
        this.saveSettings();

        // 移除旧的事件监听
        this.app.workspace.off('editor-change', this.onEditHandler);

        // 创建新的防抖处理函数
        this.onEditHandler = debounceFunc(() => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const editor = activeView.editor;
                this.convertPatterns(editor);
            }
        }, this.settings.autoConvertDelay);

        // 重新注册编辑器变化事件
        this.registerEvent(this.app.workspace.on('editor-change', this.onEditHandler));
    }

    /**
     * 执行特定字符组合的自动转换，并保持光标位置
     * @param editor 当前编辑器实例
     */
    private convertPatterns(editor: Editor) {
        const cursor = editor.getCursor(); // 保存光标位置
        const currentLineNumber = cursor.line;
        const currentLineText = editor.getLine(currentLineNumber);

        // 获取所有行内容
        const allLines = editor.getValue().split('\n');

        // 判断当前行是否在代码块内
        const inCodeBlock = isLineInCodeBlock(allLines, currentLineNumber);

        if (inCodeBlock) {
            // 当前行在代码块内，跳过替换
            return;
        }

        // 获取替换后的行内容
        const { newLine, replaced } = replacePatternsInLine(currentLineText);

        if (replaced) {
            // 获取光标在行内的位置
            const beforeCursorText = currentLineText.substring(0, cursor.ch);

            // 计算替换前触发字符的位置和长度
            let triggerStart = -1;
            let triggerLength = 0;
            let matchedPattern: { trigger: string; replacement: string } | null = null;
            const patterns = [
                { trigger: '··· ', replacement: '``````' }, // 六个反引号
                { trigger: '· ', replacement: '``' },        // 两个反引号
                { trigger: '》 ', replacement: '>' },        // 引用符号
                { trigger: '〉 ', replacement: '>' }         // 引用符号
            ];

            for (const pattern of patterns) {
                const index = beforeCursorText.lastIndexOf(pattern.trigger);
                if (index !== -1) {
                    triggerStart = index;
                    triggerLength = pattern.trigger.length;
                    matchedPattern = pattern;
                    break;
                }
            }

            if (triggerStart !== -1 && matchedPattern !== null) {
                // 定义替换范围
                const from = { line: currentLineNumber, ch: triggerStart };
                const to = { line: currentLineNumber, ch: triggerStart + triggerLength };

                // 定义替换内容
                const replacement = matchedPattern.replacement;

                if (replacement) {
                    // 执行替换
                    editor.replaceRange(replacement, from, to);

                    // 设置光标位置到替换后的中间
                    // 对于 '· ' → '`` '，光标应在两个反引号之间，即位置 1
                    // 对于 '··· ' → '`````` '，光标应在前三个反引号之后，即位置 3
                    let newCursorCh: number;

                    if (matchedPattern.trigger === '· ') {
                        newCursorCh = triggerStart + 1; // After first backtick
                    } else if (matchedPattern.trigger === '··· ') {
                        newCursorCh = triggerStart + 3; // After third backtick
                    } else {
                        // For other patterns like '》 ' and '〉 ', place cursor after replacement
                        newCursorCh = triggerStart + replacement.length;
                    }

                    editor.setCursor({ line: currentLineNumber, ch: newCursorCh });

                    new Notice('✨ Auto Convert Markdown Chars ✨');
                }
            }
        }
    }
}

/**
 * 插件的设置选项卡
 */
class AutoConvertCharsSettingTab extends PluginSettingTab {
    plugin: AutoConvertCharsPlugin;

    constructor(app: App, plugin: AutoConvertCharsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // 设置标题
        containerEl.createEl('h2', { text: 'Auto Convert Chars 设置' });

        // 自动识别延迟设置
        new Setting(containerEl)
            .setName('自动转换延迟（毫秒）')
            .setDesc('设置自动识别并转换特定字符组合的延迟时间，默认100毫秒。')
            .addText(text => text
                .setPlaceholder('100')
                .setValue(this.plugin.settings.autoConvertDelay.toString())
                .onChange(async (value) => {
                    const parsed = parseInt(value);
                    if (!isNaN(parsed) && parsed >= 0) {
                        // 调用插件的公共方法更新延迟时间
                        this.plugin.updateAutoConvertDelay(parsed);
                        new Notice(`自动转换延迟已设置为 ${parsed} 毫秒`);
                    } else {
                        new Notice('请输入有效的毫秒数（非负整数）。');
                    }
                }));
    }
}
