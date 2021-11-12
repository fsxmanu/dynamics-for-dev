import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import * as fs from 'fs';
import { DynamicsRequests } from "../connection/dynamics-requests";
import { Helpers } from "../helpers";
import { Mapper } from "../mapping/mapping-file-provider";

export class WebResourceUploader {

    _prefix: string = "";
    _webResourceFolder: string = "";
    _data: any = null;
    _selectedFile: string = "";
    _rootPath: string;
    _connection: DefaultAzureCredential;
    _configFileLocation: string;
    _fullPath : string = "";
    _dynamicsRequest : DynamicsRequests;

    constructor(workSpaceRootPath: string) {
        this._rootPath = workSpaceRootPath;
        this._connection = new DefaultAzureCredential();
        this._configFileLocation = this._rootPath + '/dynamicsConfig.json';
        this._dynamicsRequest = new DynamicsRequests(this._connection);
    }

    setUpRequiredVariables() {
        return new Promise<void>((resolve, reject) => {
            this._dynamicsRequest._data = Mapper.getConfigData(this._configFileLocation);
            this._data = this._dynamicsRequest._data;
            if(this._data === null) { return; }
            this.getWebResourceFolder().then((webResourceFolder) => {
                this._webResourceFolder = webResourceFolder;
                Helpers.determinePrefix(this._data).then((prefix) => {
                    this._dynamicsRequest._prefix = prefix;
                    this._prefix = prefix;
                    resolve();
                });
            });
        });
    }

    async uploadWebResourceContext(file: any) {
        await this.setUpRequiredVariables();
        this._selectedFile = file.path.replace(/^.*[\\\/]/, '');
        this._dynamicsRequest._selectedFile = this._selectedFile;
        this._fullPath = file.path.substring(0, file.path.lastIndexOf("/"));
        if(this._data === null) { return; }
        this.uploadWebResources();
    }

    uploadWebResource() {
		try {
            this.setUpRequiredVariables().then(() => {
                this.readWebResources().then(() => {
                    this._fullPath = this._rootPath + this._webResourceFolder;
                    this.uploadWebResources();
                });
            });
		} catch (err){
			vscode.window.showErrorMessage(`There was an error uploading your web resource. Make sure you have a dynamicsConfig.json file in your root workspace folder. Reason: ${err}`);
			console.log(err);
		}
    }

    getWebResourceFolder() : Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let folderOptions = this._data.NamingConvention.WebResourceFolder;
            if (folderOptions.length > 1){
                this.getWebResourceLocation(folderOptions).then(folder => { resolve(folder); });
            } else {
                resolve(folderOptions);
            }
        });
		
    }

    getWebResourceLocation(folderOptions: any) : Promise<string> {
        return new Promise((resolve, reject) => {
            vscode.window.showQuickPick(folderOptions, { canPickMany: false, title: "Please select the JS Folder in which the resource is located" }).then(selectedFolder =>
            {
                if (!selectedFolder || selectedFolder === undefined){ reject(""); return; }
                resolve(selectedFolder);
            });    
        });
    }

    readWebResources() : Promise<void>{ 
        return new Promise((resolve, reject) => {
            let webResources = fs.readdirSync(this._rootPath + this._webResourceFolder);
            vscode.window.showQuickPick(webResources).then(selectedFile => {
                if(!selectedFile){ return; }
                try {
                    this._selectedFile = selectedFile;
                    this._dynamicsRequest._selectedFile = selectedFile;
                    resolve();
                } catch (err){
                    vscode.window.showErrorMessage(`There was an error uploading your webresource, Reason: ${err}`);
                    resolve();
                }
            })
            .then(undefined, err => {
                console.error(err);
                resolve();
            });
        });
    }
    
    uploadWebResources() {
		try{
            var filter = `filter=name eq '${this._prefix}${this._selectedFile}'`;
            this._dynamicsRequest.getWebResource(filter).then((webResource) => {
                if(webResource.value.length === 0) {
                    this.askToCreate();
                }
                else {
                    this.uploadFile(false, webResource.value[0]);
                }
            });
		} catch (err) {
			vscode.window.showErrorMessage(`There was an error getting the web resources. Reason: ${err}`);
			console.log(err);
		}
	}

    uploadFile(isNew: boolean, existingFile?: any) {
		let fileContent: string;
        let fullPath = Mapper.fixPath(this._fullPath);
		fileContent = fs.readFileSync(`${fullPath}/${this._selectedFile}`, {encoding: 'base64'});
		if(isNew){
			this.chooseWebResourceType().then(webResourceType => {
                this._dynamicsRequest.uploadNewWebResource(webResourceType, fileContent).then((match) => {
                    this._dynamicsRequest.publishWebResource(match).then(webresourceId => {
                        this._dynamicsRequest.addToSolution().then(solutions => {
                            this._dynamicsRequest.selectSolutionToAdd(solutions, webresourceId);
                        });
                    });
                });
            });
		}
		else {
			this._dynamicsRequest.updateExistingWebResource(existingFile, fileContent).then(() => {
                if(this._data.UploadOptions.AddExistingToSolution === true){
                    this.askToAddToSolution(existingFile);
                }
                this._dynamicsRequest.publishWebResource(existingFile.webresourceid);
            });
		}
	}

    chooseWebResourceType() {
        return new Promise<string>((resolve, reject) => {
            let webResourceTypes = [ "JavaScript", "Html", "Css", "XML", "PNG", "JPG", "GIF", "XAP", "XSL", "ICO", "SVG", "RESX" ];
            vscode.window.showQuickPick(webResourceTypes, {canPickMany: false, title: "Please choose the webresource type"}).then(selected => {
                if(!selected){ return; }
                resolve(selected);
            })
            .then(undefined, err => {
                vscode.window.showErrorMessage("Couldn't choose the webresource type'");
                console.error(err); 
            });
        });
    }

    askToCreate() {
        vscode.window.showQuickPick(["Yes", "No"], { canPickMany: false, title: "WebResource does not exist, do you want to create it?" }).then(selected => {
            if (!selected) { return; }
            if (selected === "Yes") {
                this.uploadFile(true);
            }
        })
        .then(undefined, err => { 
            vscode.window.showErrorMessage(`There was an error createing the web resource. Reason: ${err}`);
            console.error(err);
        });
    }

    askToAddToSolution(existingFile: any) {
        vscode.window.showQuickPick(["Yes", "No"], { canPickMany: false, title: "Do you want to add the WebResource to a Solution?" }).then(selected => {
            if (!selected) { return; }
            if (selected === "Yes") {
                this._dynamicsRequest.addToSolution().then(solutions => {
                    this._dynamicsRequest.selectSolutionToAdd(solutions, existingFile.webresourceid);
                });
            }
        }).then(undefined, err => { 
			vscode.window.showErrorMessage("Couldn't add the WebResource to solution.");
			console.error(err);	
		});
    }
}
