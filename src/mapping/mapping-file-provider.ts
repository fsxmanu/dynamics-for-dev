import * as vscode from "vscode";

export function returnUploadConfig() : string {
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
        }
    }`;
    return config;
}

export function createTemplateFile() {
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
                    createNewTemplate(filePath);
                }
            })
            .then(undefined, err => {
                console.error(err);
            });
        }).then(undefined, () => {
            createNewTemplate(filePath);
        });
    }
    catch (err){
        console.log(err);
    }
}

export function createNewTemplate(filePath: any){
	const writeData = Buffer.from(returnUploadConfig(), 'utf8');
	vscode.workspace.fs.writeFile(filePath, writeData);
	vscode.window.showInformationMessage('Created a new dynamicsConfig.json');
}