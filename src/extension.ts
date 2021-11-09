// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WebResourceUploader } from './webresource/webresource-uploader';
import { createTemplateFile } from './mapping/mapping-file-provider';
import { WebResourceDownloader } from './webresource/webresource-downloader';
import { SolutionExporter } from './solution/solution-exporter';
import { RibbonManager } from './ribbon-manager/ribbon-functions';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const workSpaceFolder = vscode.workspace.workspaceFolders;

	if (workSpaceFolder === undefined) {
		vscode.window.showErrorMessage("No workspace open. Please open a workspace");
		return;
	}
	let basePath = workSpaceFolder[0].uri.path;

	let uploadCommand = vscode.commands.registerCommand('dynamics-for-dev.uploadWebResource', () => new WebResourceUploader(basePath).uploadWebResource());
	context.subscriptions.push(uploadCommand);

	let addJsonTemplateCommand = vscode.commands.registerCommand('dynamics-for-dev.addDynamicsConfig', () => {
		createTemplateFile();
	});
	context.subscriptions.push(addJsonTemplateCommand);

	let uploadContextCommand = vscode.commands.registerCommand('dynamics-for-dev.uploadWebResourceContext', (file) => new WebResourceUploader(basePath).uploadWebResourceContext(file));
	context.subscriptions.push(uploadContextCommand);

	let downloadContextCommand = vscode.commands.registerCommand('dynamics-for-dev.downloadWebResourceContext', (folder) => new WebResourceDownloader(basePath).downloadWebResourceContext(folder));
	context.subscriptions.push(downloadContextCommand);

	let exportSolution = vscode.commands.registerCommand('dynamics-for-dev.exportSolutionContext', (folder) => new SolutionExporter(basePath).exportSolutionContext(folder));
	context.subscriptions.push(exportSolution);

	let ribbonManager = vscode.commands.registerCommand('dynamics-for-dev.getRibbonInformation', () => new RibbonManager(basePath).getRibbonInformation());
	context.subscriptions.push(ribbonManager);
}

// this method is called when your extension is deactivated
export function deactivate() {}