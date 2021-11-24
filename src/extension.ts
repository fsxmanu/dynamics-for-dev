// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WebResourceUploader } from './webresource/webresource-uploader';
import { Mapper } from './mapping/mapping-file-provider';
import { WebResourceDownloader } from './webresource/webresource-downloader';
import { SolutionExporter } from './solution/solution-exporter';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const workSpaceFolder = vscode.workspace.workspaceFolders;

	if (workSpaceFolder === undefined) {
		vscode.window.showErrorMessage("No workspace open. Please open a workspace");
		return;
	}
	let basePath = workSpaceFolder[0].uri.path;

	let uploadCommand = vscode.commands.registerCommand('dynamics-for-dev.uploadWebResource', () => {
		try {
			new WebResourceUploader(basePath).uploadWebResource();
		}
		catch(err){
			vscode.window.showErrorMessage(`There was an error uploading the webresource. Reason: ${err}`);
		}
	});
	context.subscriptions.push(uploadCommand);

	let addJsonTemplateCommand = vscode.commands.registerCommand('dynamics-for-dev.addDynamicsConfig', () => {
		try {
			new Mapper().createTemplateFile();
		}
		catch (err) {
			vscode.window.showErrorMessage(`There was an error creationg the file. Reason: ${err}`);
		}
	});
	context.subscriptions.push(addJsonTemplateCommand);

	let uploadContextCommand = vscode.commands.registerCommand('dynamics-for-dev.uploadWebResourceContext', (file) => {
		try {
			new WebResourceUploader(basePath).uploadWebResourceContext(file);
		}
		catch (err) {
			vscode.window.showErrorMessage(`There was an error uploading the web resource. Reason: ${err}`);
		}
		
	});
	context.subscriptions.push(uploadContextCommand);

	let downloadContextCommand = vscode.commands.registerCommand('dynamics-for-dev.downloadWebResourceContext', (folder) => {
		try {
			new WebResourceDownloader(basePath).downloadWebResourceContext(folder);
		} catch (err) {
			vscode.window.showErrorMessage(`There was an error downloading the webresource. Reason: ${err}`);
		}
	});
	context.subscriptions.push(downloadContextCommand);

	let exportSolution = vscode.commands.registerCommand('dynamics-for-dev.exportSolutionContext', (folder) => {
		try {
			new SolutionExporter(basePath).exportSolutionContext(folder);
		} catch (err) {
			vscode.window.showErrorMessage(`There was an error exporting the solution. Reason: ${err}`);
		}
	});
	context.subscriptions.push(exportSolution);
}

// this method is called when your extension is deactivated
export function deactivate() {}