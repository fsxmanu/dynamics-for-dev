// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WebResourceProcessor } from './webresource/webresource-processor';
import { useIdentityPlugin, DefaultAzureCredential } from "@azure/identity";
import { vsCodePlugin } from "@azure/identity-vscode";

useIdentityPlugin(vsCodePlugin);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const workSpaceFolder = vscode.workspace.workspaceFolders;

	if (workSpaceFolder === undefined) {
		vscode.window.showErrorMessage("No workspace open. Please open a workspace");
		return;
	}
	let basePath = workSpaceFolder[0].uri.path;

	let uploadCommand = vscode.commands.registerCommand('dynamics-for-dev.uploadWebResource', () => new WebResourceProcessor(basePath).uploadWebResource());
	context.subscriptions.push(uploadCommand);

	let addJsonTemplateCommand = vscode.commands.registerCommand('powerwebresource-manager.AddUploadJsonTemplate', () => {
		
	});

	context.subscriptions.push(addJsonTemplateCommand);
}

// this method is called when your extension is deactivated
export function deactivate() {}