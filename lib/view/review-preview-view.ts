import * as path from "path";

import {$, $$$, ScrollView} from "atom-space-pen-views";

import {File} from "pathwatcher";

import * as V from "../util/const";
import * as logger from "../util/logger";
import * as ReVIEW from "review.js";
import ReVIEWRunner from "../util/review-runner";

export default class ReVIEWPreviewView extends ScrollView {

    editorId: string;
    file: PathWatcher.IFile;
    editor: AtomCore.IEditor;

    runner: ReVIEWRunner;

    fontSizeObserveSubscription: AtomCore.IDisposable;
    fontFamilyObserveSubscription: AtomCore.IDisposable;

    static deserialize(state: any): ReVIEWPreviewView {
        return new ReVIEWPreviewView(state);
    }

    static content(): any {
        return this.div({ class: "review-preview native-key-bindings", tabindex: -1 });
    }

    constructor(params: { editorId?: string; filePath?: string; } = {}) {
        super();

        this.editorId = params.editorId;

        if (this.editorId) {
            var promise = this.resolveEditor(this.editorId);
            promise.then(editor=> {
                this.runner = new ReVIEWRunner({ editor: editor });
                this.handleEvents();
            }).catch(reason=> {
                // The editor this preview was created for has been closed so close
                // this preview since a preview cannot be rendered without an editor
                var view = this.jq.parents(".pane").view();
                if (view) {
                    view.destroyItem(this);
                }
            });
        } else {
            this.file = new File(params.filePath);
            this.runner = new ReVIEWRunner({ file: this.file });
            this.handleEvents();
        }
    }

    get jq(): JQuery {
        // dirty hack
        return <any>this;
    }

    attached() {
        this.fontSizeObserveSubscription = atom.config.observe("editor.fontSize", newValue => {
            this.adjustFont({ fontSize: newValue });
        });
        this.fontFamilyObserveSubscription = atom.config.observe("editor.fontFamily", newValue => {
            this.adjustFont({ fontFamily: newValue });
        });
    }

    detached() {
        this.fontSizeObserveSubscription.dispose();
        this.fontSizeObserveSubscription = null;
        this.fontFamilyObserveSubscription.dispose();
        this.fontFamilyObserveSubscription = null;
    }

    adjustFont({fontSize, fontFamily}: { fontSize?: number; fontFamily?: string }) {
        fontSize = fontSize || atom.config.get("editor.fontSize");
        fontFamily = fontFamily || atom.config.get("editor.fontFamily");
        this.jq.css("font-family", fontFamily);
        this.jq.css("font-size", fontSize);
    }

    serialize() {
        return {
            deserializer: "ReVIEWPreviewView",
            filePath: this.file ? this.getPath() : null,
            editorId: this.editorId
        };
    }

    destroy() {
        this.runner.deactivate();
    }

    resolveEditor(editorId: string): Promise<AtomCore.IEditor> {
        return new Promise<AtomCore.IEditor>((resolve, reject) => {
            let func = () => {
                var editor = this.editorForId(editorId);
                this.editor = editor;

                if (editor) {
                    this.jq.trigger("title-changed");
                    resolve(editor);
                } else {
                    reject();
                }
            };

            if (atom.workspace) {
                func();
            } else {
                atom.packages.onDidActivateInitialPackages(() => {
                    func();
                });
            }
        });
    }

    editorForId(editorId: string) {
        var foundEditors = atom.workspace.getTextEditors().filter(editor=> {
            var id = editor.id;
            if (!id) {
                return false;
            }
            return id.toString() === editorId.toString();
        });
        return foundEditors[0];
    }

    handleEvents() {
        atom.commands.add(<any>this, "core:move-up", () => this.jq.scrollUp());
        atom.commands.add(<any>this, "core:move-down", () => this.jq.scrollDown());

        atom.commands.add("atom-workspace", "language-review:zoom-in", () => {
            var zoomLevel = parseFloat(this.jq.css("zoom")) || 1;
            this.jq.css("zoom", zoomLevel + 0.1);
        });
        atom.commands.add("atom-workspace", "language-review:zoom-out", () => {
            var zoomLevel = parseFloat(this.jq.css("zoom")) || 1;
            this.jq.css("zoom", zoomLevel - 0.1);
        });
        atom.commands.add("atom-workspace", "language-review:reset-zoom", () => {
            this.jq.css("zoom", 1);
        });

        var changeHandler = () => {
            var pane = atom.workspace.paneForURI(this.getURI());
            if (pane && pane !== atom.workspace.getActivePane()) {
                pane.activateItem(this);
            }
        };

        this.runner.on("start", () => {
            this.showLoading();
        });
        this.runner.on("report", reports => {
            logger.log(reports);
        });
        this.runner.on("compile-success", book => {
            changeHandler();
            book.allChunks[0].builderProcesses.forEach(process => {
                var $html = this.resolveImagePaths(process.result);
                this.jq.empty().append($html);
            });
        });
        this.runner.on("compile-failed", book => {
            changeHandler();
            let $result = $("<div>");
            book.allChunks[0].process.reports.forEach(report => {
                let $report = $("<div>");
                let type = "Unknown";
                switch (report.level) {
                    case ReVIEW.ReportLevel.Error:
                        type = "Error";
                        $report.addClass("text-error");
                        break;
                    case ReVIEW.ReportLevel.Warning:
                        type = "Warning";
                        $report.addClass("text-warning");
                        break;
                    case ReVIEW.ReportLevel.Info:
                        type = "Info";
                        $report.addClass("text-info");
                        break;
                }

                let line = report.nodes[0].location.start.line;
                let column = report.nodes[0].location.start.column - 1;
                $report.text(`[${line},${column}] ${type} ${report.message}`);
                $report.appendTo($result);
            });
            this.jq.empty().append($result);
        });

        this.runner.activate();

        if (this.runner.editor) {
            atom.commands.add("atom-text-editor", "path-changed", () => this.jq.trigger("title-changed"));
        }
    }

    renderReVIEW() {
        this.runner.doCompile();
    }

    getTitle(): string {
        if (this.file) {
            return path.basename(this.getPath()) + " Preview";
        } else if (this.editor) {
            return this.editor.getTitle() + " Preview";
        } else {
            return "Re:VIEW Preview";
        }
    }

    getURI(): string {
        if (this.file) {
            return "language-review://" + this.getPath();
        } else {
            return "language-review://" + V.previewHost + "/" + this.editorId;
        }
    }

    getPath(): string {
        if (this.file) {
            return this.file.getPath();
        } else if (this.editor) {
            return this.editor.getPath();
        }
        return null;
    }

    showError(result: any = {}) {
        var failureMessage = result.message;

        this.jq.html($$$(function() {
            this.h2("Previewing Re:VIEW Failed");
            if (failureMessage) {
                return this.h3(failureMessage);
            }
        }));
    }

    showLoading() {
        this.jq.html($$$(function() {
            this.div({ class: "review-spinner" }, "Loading Re:VIEW\u2026");
        }));
    }

    resolveImagePaths(html: any): JQuery {
        var $html = $(html);
        var imgList = $html.find("img");
        for (var i = 0; i < imgList.length; i++) {
            var img = $(imgList[i]);
            var src = img.attr("src");
            if (src.match(/^(https?:\/\/)/)) {
                continue;
            }
            img.attr("src", path.resolve(path.dirname(this.getPath()), src));
        }

        return $html;
    }
}

atom.deserializers.add(ReVIEWPreviewView);
