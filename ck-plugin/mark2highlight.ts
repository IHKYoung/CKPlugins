import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

/**
 * 插件的设置接口
 */
interface Mark2HighlightPluginSettings {
    autoConvertDelay: number; // 自动转换的延迟时间（毫秒）
}

/**
 * 插件的默认设置
 */
const DEFAULT_SETTINGS: Mark2HighlightPluginSettings = {
    autoConvertDelay: 500
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
 * 替换单行中的 ==xxx== 为 <mark>xxx</mark>，但忽略行内代码中的 ==。
 * @param line 原始行内容
 * @returns 替换后的行内容及是否进行了替换
 */
function replaceHighlightLine(line: string): { newLine: string; replaced: boolean } {
    let inInlineCode = false;
    let result = '';
    let replaced = false;

    for (let i = 0; i < line.length; i++) {
        if (line[i] === '`') {
            inInlineCode = !inInlineCode;
            result += line[i];
            continue;
        }

        if (!inInlineCode && line[i] === '=' && line[i + 1] === '=') {
            // 找到 == 开始
            const endIdx = line.indexOf('==', i + 2);
            if (endIdx !== -1) {
                const highlightedText = line.substring(i + 2, endIdx);
                result += `<mark>${highlightedText}</mark>`;
                i = endIdx + 1; // 跳过结束 ==
                replaced = true;
                continue;
            }
        }

        result += line[i];
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

export default class Mark2HighlightPlugin extends Plugin {
    settings: Mark2HighlightPluginSettings;
    private onEditHandler: () => void;

    /**
     * 加载插件时的初始化逻辑
     */
    async onload() {
        await this.loadSettings();

        // 添加一个命令用于高亮替换
        this.addCommand({
            id: 'convert-highlight',
            name: 'Convert ==xxx== to <mark>xxx</mark>',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.convertHighlight(editor);
            }
        });

        // 创建防抖后的编辑器变化处理函数
        this.onEditHandler = debounceFunc(() => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const editor = activeView.editor;
                this.convertHighlight(editor);
            }
        }, this.settings.autoConvertDelay);

        // 注册编辑器变化事件
        this.registerEvent(this.app.workspace.on('editor-change', this.onEditHandler));

        // 添加设置选项卡
        this.addSettingTab(new Mark2HighlightSettingTab(this.app, this));
    }

    /**
     * 卸载插件时的清理逻辑
     */
    onunload() {
        console.log('Mark to Highlight Plugin Unloaded.');
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
                this.convertHighlight(editor);
            }
        }, this.settings.autoConvertDelay);

        // 重新注册编辑器变化事件
        this.registerEvent(this.app.workspace.on('editor-change', this.onEditHandler));
    }

    /**
     * 执行高亮转换，并保持光标位置
     * @param editor 当前编辑器实例
     */
    private convertHighlight(editor: Editor) {
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

        const { newLine, replaced } = replaceHighlightLine(currentLineText);

        if (replaced) {
            // 计算光标在替换前的位置
            const beforeCursorText = currentLineText.substring(0, cursor.ch);

            // 替换行内容
            editor.setLine(currentLineNumber, newLine);

            // 找到 </mark> 在新行的位置
            const markEnd = newLine.indexOf('</mark>', beforeCursorText.length);
            if (markEnd !== -1) {
                const newCh = markEnd + '</mark>'.length;
                editor.setCursor({ line: currentLineNumber, ch: newCh });
            } else {
                // 如果没有找到 </mark>，则将光标设置到行尾
                editor.setCursor({ line: currentLineNumber, ch: newLine.length });
            }

            new Notice('✨ Markdown Highlight Converted Automatically!');
        }
    }
}

/**
 * 插件的设置选项卡
 */
class Mark2HighlightSettingTab extends PluginSettingTab {
    plugin: Mark2HighlightPlugin;

    constructor(app: App, plugin: Mark2HighlightPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // 设置标题
        containerEl.createEl('h2', { text: 'Mark to Highlight 设置' });

        // 自动识别延迟设置
        new Setting(containerEl)
            .setName('自动转换延迟（毫秒）')
            .setDesc('设置自动识别并转换 ==xxx== 的延迟时间，默认500毫秒。')
            .addText(text => text
                .setPlaceholder('500')
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
