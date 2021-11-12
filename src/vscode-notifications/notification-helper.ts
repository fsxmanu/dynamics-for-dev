import * as vscode from "vscode";

export class Notification {

    static showInfo(message: string){
        vscode.window.showInformationMessage(message);
    }

    static showError(message: string){
        vscode.window.showErrorMessage(message);
    }

    static async showPick(options: any, messageTitle: string) : Promise<any> {
        return new Promise<any>((resolve) => {
            vscode.window.showQuickPick(options, { canPickMany: false, title: messageTitle}).then((selected) => {
                if(!selected) { resolve(null); }
                resolve(selected);
            });
        });
    }
}