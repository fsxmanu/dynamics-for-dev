import * as vscode from "vscode";
import * as fs from 'fs';

export class Mapper {
    static returnUploadConfig() : string {
        let config = `{
    "NamingConvention" : {
        "WebResourceFolder" : [ "/JsFoler1/path", "/Jsfolder2/path" ],
        "Prefix" : [ "new_/CustomJsFolder/", "new_" ]
    },
    "OrgInfo" : {
        "CrmUrl" : "https://yourorganization.yourregion.dynamics.com",
        "ApiVersion" : "9.1"
    },
    "UploadOptions" : {
        "AddExistingToSolution" : false
    },
    "Solutions" : [ ]
}`;
        return config;
    }

    createTemplateFile() {
        try {
            let workSpaceFolder = vscode.workspace.workspaceFolders;
            if(workSpaceFolder === undefined) { return; }
            const wsPath = workSpaceFolder[0].uri.fsPath;
            const filePath = vscode.Uri.file(wsPath + '/dynamicsConfig.json');
            vscode.workspace.fs.stat(filePath).then(() => {
                vscode.window.showQuickPick([ "Yes", "No" ], { canPickMany: false, title: "File already exists. Do you want to overwrite it?" }).then(selected => {
                    if(!selected){
                        return; 
                    }
                    if(selected === "Yes"){
                        Mapper.createNewTemplate(filePath);
                    }
                })
                .then(undefined, err => {
                    console.error(err);
                });
            }).then(undefined, () => {
                Mapper.createNewTemplate(filePath);
            });
        }
        catch (err){
            console.log(err);
        }
    }
    
    static createNewTemplate(filePath: any){
        const writeData = Buffer.from(Mapper.returnUploadConfig(), 'utf8');
        vscode.workspace.fs.writeFile(filePath, writeData);
        vscode.window.showInformationMessage('Created a new dynamicsConfig.json');
    }
    
    static fixPath(path: string) {
        var windowsSystemRegex = /(\/[A-Za-z]:\/\w+)/g;
        let match = path.match(windowsSystemRegex);
        
        //return fixed path if OS is Windoof
        if(match !== null) {
            return path.substring(1, path.length);
        }
        else {
            return path;
        }
    }
    
    static getConfigData(this: any, configFileLocation: string) {
        let configPath = this.fixPath(configFileLocation);
        if(fs.existsSync(configPath)){
            return JSON.parse(fs.readFileSync(configPath, "utf-8"));
        }
        else {
            vscode.window.showErrorMessage(`No dynamicsConfig.json file was found. Please add one in ${this._rootPath}`);
        }
    }
}