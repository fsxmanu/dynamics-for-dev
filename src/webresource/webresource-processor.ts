import * as vscode from "vscode";
import { DefaultAzureCredential, AccessToken, AzureCliCredentialOptions } from "@azure/identity";
import { Helpers } from "../helpers";
import * as fs from 'fs';

let _tokenResult: AccessToken;

export class WebResourceProcessor {
    _prefix: string = "";
    _webResourceFolder: string = "";
    _data: any = null;
    _selectedFile: string = "";
    _rootPath: string;
    _connection: DefaultAzureCredential;
    _configFileLocation: string;

    constructor(workSpaceRootPath: string) {
        this._rootPath = workSpaceRootPath;
        this._connection = new DefaultAzureCredential();
        this._configFileLocation = this._rootPath + '/dynamicsConfig.json';
    }

    setUpRequiredVariables() {
        return new Promise<void>((resolve, reject) => {
            this.getConfigData();
            if(this._data === null) { return; }
            this.getWebResourceFolder().then((webResourceFolder) => {
                this._webResourceFolder = webResourceFolder;
                this.determinePrefix().then((prefix) => {
                    this._prefix = prefix;
                    resolve();
                });
            });
        });
    }

    getConfigData() {
        if(fs.existsSync(this._configFileLocation)){
            this._data = JSON.parse(fs.readFileSync(this._configFileLocation, "utf-8"));
        }
        else {
            vscode.window.showErrorMessage(`No dynamicsConfig.json file was found. Please add one in ${this._rootPath}`);
        }
    }

    async uploadWebResourceContext(){
        await this.getConfigData();
        if(this._data === null) { return; }
        
    }

    uploadWebResource(){
		try {
            this.setUpRequiredVariables().then(() => {
                this.readWebResources().then(() => {
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
            this.getWebResource().then((webResource) => {
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
		fileContent = fs.readFileSync(`${this._rootPath}${this._webResourceFolder}/${this._selectedFile}`, {encoding: 'base64'});
		if(isNew){
			this.chooseWebResourceType().then(webResourceType => {
                this.uploadNewWebResource(webResourceType, fileContent).then((match) => {
                    this.publishWebResource(match).then(webresourceId => {
                        this.addToSolution().then(solutions => {
                            this.selectSolutionToAdd(solutions, webresourceId);
                        });
                    });
                });
            });
		}
		else {
			this.updateExistingWebResource(existingFile, fileContent).then(() => {
                if(this._data.UploadOptions.AddExistingToSolution === true){
                    this.askToAddToSolution(existingFile);
                }
                this.publishWebResource(existingFile.webresourceid);
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

    uploadNewWebResource(webResourceType: string, fileContent: any) : Promise<string> {
		try{
            return new Promise<string>((resolve, reject) => {
                let xmlHttpRequest = require('xhr2');
                var req = new xmlHttpRequest();
                let entity = Helpers.createEntity(fileContent, this._selectedFile, webResourceType, this._prefix);
                req.open("POST", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset`);
                req = this.setRequestHeaders(req, "application/json; charset=utf-8").then(response => {
                    req = response;
                    req.addEventListener("load", function() {
                        let regExp = /\(([^)]+)\)/;
                        let matches = regExp.exec(req.getResponseHeader("OData-EntityId"));
                        if(matches === undefined || matches === null || matches.length < 1) { return; }
                        vscode.window.showInformationMessage("WebResource was uploaded to CRM successfully.");
                        resolve(matches[1]);
                    }, false);
                    vscode.window.showInformationMessage("Uploading webresource...");
                    req.send(entity);
                });
            });
		} catch (err) {
			vscode.window.showErrorMessage(`There was an error uploading your WebResource to CRM. Reason: ${err}`);
			console.error(err);
            return new Promise<string>((resolve, reject) => {
                reject(err);
            });
		}
	}

	updateExistingWebResource(existingFile: any, fileContent: any) {
        return new Promise<void>((resolve, reject) => {
            var entity = { "content": fileContent };
            try {
                let xmlHttpRequest = require('xhr2');
                var req = new xmlHttpRequest();
                req.open("PATCH", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset(${existingFile.webresourceid})`);
                req = this.setRequestHeaders(req, "application/json; charset=utf-8").then(response => {
                    req = response;
                    req.addEventListener("load", function() {
                        vscode.window.showInformationMessage("Resource was uploaded to CRM successfully.");
                        resolve();
                    }, false);
                    vscode.window.showInformationMessage("Updating webresource...");
                    req.send(JSON.stringify(entity));
                });
            } catch (err) {	
                vscode.window.showErrorMessage(`There was an error uploading your WebResource to CRM. Reason: ${err}`);
                console.error(err);	
                reject(err);
            }
        });
	}

    askToAddToSolution(existingFile: any) {
        vscode.window.showQuickPick(["Yes", "No"], { canPickMany: false, title: "Do you want to add the WebResource to a Solution?" }).then(selected => {
            if (!selected) { return; }
            if (selected === "Yes") {
                this.addToSolution().then(solutions => {
                    this.selectSolutionToAdd(solutions, existingFile.webresourceid);
                });
            }
        }).then(undefined, err => { 
			vscode.window.showErrorMessage("Couldn't add the WebResource to solution.");
			console.error(err);	
		});
    }

    selectSolutionToAdd(solutions: any, fileId: any) {
        vscode.window.showQuickPick(solutions, {canPickMany: false, title: "Select Solution to add the Web Resource to."}).then(selected => {
            if(!selected){ return; }
            this.addComponentToSolution(fileId, selected);		
        })
        .then(undefined, err => { 
            vscode.window.showErrorMessage("There was an error getting the solutions");
            console.error(err); 
        });
    }

    addToSolution() : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            var xmlHttpRequest = require('xhr2');
		    var req = new xmlHttpRequest();
		    req.open("GET", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/solutions?\$select=friendlyname,solutionid,uniquename&\$filter=ismanaged eq false&\$orderby=friendlyname asc`);
		    req = this.setRequestHeaders(req, "application/json; charset=utf-8").then(response => {
                req = response;
                req.addEventListener("load", function() {
                    let solutions = [""];
                    let response = JSON.parse(req.response);
                    response.value.forEach((element: any) => {
                        if(element.uniquename !== "Active" && element.uniquename !== "Default"){
                            solutions.push(element.uniquename);
                        }
                    });
                    resolve(solutions);
                }, false);
                req.send();
            });
        });
	}

    addComponentToSolution(crmId: any, selectedSolution: string) {
		let body = Helpers.createAddToSolutionRequestBody(crmId, selectedSolution);
		var xmlHttpRequest = require('xhr2');
		var req = new xmlHttpRequest();

		req.open("POST", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/AddSolutionComponent`);
		req = this.setRequestHeaders(req, "application/json").then(response => {
            req = response;
            req.addEventListener("load", function() {
                if(req.status === 200){
                    vscode.window.showInformationMessage("Component was added to solution successfully.");
                }
                else {
                    vscode.window.showErrorMessage("There was an error while adding component to solution.");
                }
            }, false);
            req.send(body);
        });
		
	}

    getWebResource() : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let xmlHttpRequest = require('xhr2');
            let req = new xmlHttpRequest();
            req.open("GET", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset?\$select=content,contentjson,displayname,name,webresourceid&\$filter=name eq '${this._prefix}${this._selectedFile}'`);
            this.setRequestHeaders(req, "application/json; charset=utf-8").then(response => {
                req = response;
                req.addEventListener("load", function() {
                    let foundResources = JSON.parse(req.response);
                    resolve(foundResources);
                }, false);
                req.send();
            });
        });
    }

    async getToken() : Promise<AccessToken> {
        if(_tokenResult === null || _tokenResult === undefined || _tokenResult.expiresOnTimestamp < Date.now()) {
            return new Promise<AccessToken>((resolve) => {
                this._connection.getToken(`${this._data.OrgInfo.CrmUrl}/.default`).then(res => {
                    _tokenResult = res;
                    resolve(res);
                });
            });
        }
        else { 
            return new Promise<AccessToken>((resolve) => resolve(_tokenResult));
        }
    }

    setRequestHeaders(req: any, contentType: string): Promise<any> {
        return new Promise<any>((resolve) => {
            req.setRequestHeader("OData-MaxVersion", "4.0");
            req.setRequestHeader("OData-Version", "4.0");
            req.setRequestHeader("Accept", "application/json");
            req.setRequestHeader("Content-Type", contentType);
            this.getToken().then(() => {
                req.setRequestHeader("Authorization", "Bearer " + _tokenResult.token);
                resolve(req);
            });
        });
        // req.open, req.send and addeventlistener has to be done in the individual funcitons.
    }

    async publishWebResource(webresourceid: any) : Promise<string> {
        
		return new Promise(async (resolve, reject) => {
			/* eslint-disable */
			var parameters = {
				"ParameterXml" : `<importexportxml>
				<webresources>
				<webresource>{${webresourceid}}</webresource>
				</webresources>
				</importexportxml>`
			};
			/* eslint-enable */
			var xmlHttpRequest = require('xhr2');
		    var req = new xmlHttpRequest();
		    req.open("POST", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/PublishXml`);
		    req = await this.setRequestHeaders(req, "application/json; charset=utf-8");
			req.addEventListener("load", function() {
				if(req.status === 200 || req.status === 204){
					vscode.window.showInformationMessage("Component was published successfully.");
					resolve(webresourceid);
				}
				else {
					vscode.window.showErrorMessage("There was an error while publishing your component.");
					reject(req.status);
				}
			}, false);
			vscode.window.showInformationMessage("Component is publishing, please wait...");
			req.send(JSON.stringify(parameters));
		});
	}
}
