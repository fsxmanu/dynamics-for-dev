import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import * as fs from 'fs';
import { DynamicsRequests } from "../connection/dynamics-requests";

export class WebResourceProcessor {

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
            this.getConfigData();
            if(this._data === null) { return; }
            this.getWebResourceFolder().then((webResourceFolder) => {
                this._webResourceFolder = webResourceFolder;
                this.determinePrefix().then((prefix) => {
                    this._dynamicsRequest._prefix = prefix;
                    this._prefix = prefix;
                    resolve();
                });
            });
        });
    }

    getConfigData() {
        if(fs.existsSync(this._configFileLocation)){
            this._dynamicsRequest._data = JSON.parse(fs.readFileSync(this._configFileLocation, "utf-8"));
            this._data = JSON.parse(fs.readFileSync(this._configFileLocation, "utf-8"));
        }
        else {
            vscode.window.showErrorMessage(`No dynamicsConfig.json file was found. Please add one in ${this._rootPath}`);
        }
    }

    uploadWebResourceContext(file: any) {
        this._selectedFile = file.path.replace(/^.*[\\\/]/, '');
        this._dynamicsRequest._selectedFile = this._selectedFile;
        this._fullPath = file.path.substring(0, file.path.lastIndexOf("/"));
        this.getConfigData();
        if(this._data === null) { return; }
        this.determinePrefix().then((prefix) => {
            this._prefix = prefix;
            this.uploadWebResources();
        });
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

    determinePrefix() : Promise<string> {
        return new Promise<string>((resolve, reject) =>
        {
            let prefixOptions = this._data.NamingConvention.Prefix;
            if(prefixOptions.length > 1){
                this.getPrefix().then((prefix) => {
                resolve(prefix);
                });
            }else {
                return new Promise((resolve) =>  resolve(this._data.NamingConvention.Prefix));
            }
        });
    }

    getPrefix(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let prefixOptions = this._data.NamingConvention.Prefix;
        
            let options = [];
            for(let i = 0; i < prefixOptions.length; i++) {
                options.push(prefixOptions[i]);
            }
            vscode.window.showQuickPick(options, { canPickMany: false, title: "Please select the Prefix which should be used" }).then(selectedPrefix =>
            {
                if(!selectedPrefix){ resolve("new_"); }
                resolve(selectedPrefix);
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
            this._dynamicsRequest.getWebResource().then((webResource) => {
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
		fileContent = fs.readFileSync(`${this._fullPath}/${this._selectedFile}`, {encoding: 'base64'});
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
