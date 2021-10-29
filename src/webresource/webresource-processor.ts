import * as vscode from "vscode";
import { DefaultAzureCredential, AccessToken } from "@azure/identity";
import { Helpers } from "../helpers";
import { resolve } from "path";
const fs = require('fs');


let _prefix: string;
let _webResourceFolder: string;
let _tokenResult: AccessToken;
let _data: any = null;
let _selectedFile: string;

export class WebResourceProcessor {
    rootPath: string;
    connection: DefaultAzureCredential;
    configFileLocation: string;
    constructor(workSpaceRootPath: string) {
        this.rootPath = workSpaceRootPath;
        this.connection = new DefaultAzureCredential();
        this.configFileLocation = this.rootPath + '/dynamicsConfig.json';
    }

    async setUpRequiredVariables() {
        await this.getConfigData();
        if(_data === null) { return; }
        _webResourceFolder = await this.getWebResourceFolder();
        _prefix = await this.determinePrefix();
    }

    async getConfigData(){
        await vscode.workspace.fs.stat(vscode.Uri.parse(this.configFileLocation)).then(() => {
            _data = JSON.parse(fs.readFileSync(this.configFileLocation));
        })
        .then(undefined, () => {
            vscode.window.showErrorMessage(`No dynamicsConfig.json file was found. Please add one in ${this.rootPath}`);
            return;
        });;
    }

    async uploadWebResourceContext(){
        await this.getConfigData();
        if(_data === null) { return; }
        
    }

    async uploadWebResource(){
		try {
            await this.setUpRequiredVariables();
            this.readWebResources();
            this.uploadWebResources();
		} catch (err){
			vscode.window.showErrorMessage(`There was an error uploading your web resource. Make sure you have a dynamicsConfig.json file in your root workspace folder. Reason: ${err}`);
			console.log(err);
		}
    }

    async getWebResourceFolder() : Promise<string> {
		let folderOptions = _data.NamingConvention.WebResourceFolder;
		if (folderOptions.length > 1){
			return await this.getWebResourceLocation(folderOptions);
		} else {
            return _data.NamingConvention.WebResourceFolder;
        }
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

    async determinePrefix() : Promise<string> {
        let prefixOptions = _data.NamingConvention.Prefix;
        if(prefixOptions.length > 1){
            return new Promise((resolve) =>  {
                resolve(this.getPrefix());
            });
        }else {
            return new Promise((resolve) =>  resolve(_data.NamingConvention.Prefix));
        }
    }

    async getPrefix(): Promise<string>{
        let prefixOptions = _data.NamingConvention.Prefix;
        return new Promise((resolve, reject) => {
            let options = [];
            for(let i = 0; i < prefixOptions.length; i++) {
                options.push(prefixOptions[i]);
            }
            vscode.window.showQuickPick(options, { canPickMany: false, title: "Please select the Prefix which should be used" }).then(selectedPrefix =>
            {
                if(!selectedPrefix){ reject("new_"); return; }
                resolve(selectedPrefix);
            });
        });
    }

    async readWebResources() : Promise<void>{
        let webResources = fs.readdirSync(this.rootPath + _webResourceFolder);
        vscode.window.showQuickPick(webResources).then(selectedFile => {
            if(!selectedFile){ return; }
            try {
                _selectedFile = selectedFile;
                resolve();
            } catch (err){
                vscode.window.showErrorMessage(`There was an error uploading your webresource, Reason: ${err}`);
            }
        })
        .then(undefined, err => {
            console.error(err);
        });
    }
    
    async uploadWebResources() {
		try{
            let foundWebResource = await this.getWebResource(_data);
            if(foundWebResource.value.length === 0) {
                let wantsToUploadNewWebResource = await this.askToCreate();
                if(wantsToUploadNewWebResource){
                    this.uploadFile(true);
                }
            }
            else {
                this.uploadFile(false, foundWebResource.value[0]);
            }
		} catch (err) {
			vscode.window.showErrorMessage(`There was an error getting the web resources. Reason: ${err}`);
			console.log(err);
		}
	}

    async uploadFile(isNew: boolean, existingFile?: any) {
		let fileContent;
		fileContent = fs.readFileSync(this.rootPath + '/' + _selectedFile, {encoding: 'base64'});
		if(isNew){
			let webResourceType = await this.chooseWebResourceType();
            this.uploadNewWebResource(webResourceType, fileContent);
		}
		else {
			this.updateExistingWebResource(existingFile, fileContent);
		}
	}

    chooseWebResourceType() : Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let webResourceTypes = [ "JavaScript", "Html", "Css", "XML", "PNG", "JPG", "GIF", "XAP", "XSL", "ICO", "SVG", "RESX" ];
            vscode.window.showQuickPick(webResourceTypes, {canPickMany: false, title: "Please choose the webresource type"}).then(selected => {
                if(!selected){ return; }
                resolve(selected);
            })
            .then(undefined, err => {
                vscode.window.showErrorMessage("Couldn't choose the webresource type'");
                console.error(err); });
                reject("");
            });
    }

    askToCreate() : Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            vscode.window.showQuickPick(["Yes", "No"], { canPickMany: false, title: "WebResource does not exist, do you want to create it?" }).then(selected => {
                if (!selected) { reject(false); }
                if (selected === "Yes") {
                    resolve(true);
                }
                reject(false);
            })
            .then(undefined, err => { 
                vscode.window.showErrorMessage(`There was an error createing the web resource. Reason: ${err}`);
                console.error(err);
                reject(false);
            });
        });
    }

    uploadNewWebResource(webResourceType: string, fileContent: any) {
		try{
            let xmlHttpRequest = require('xhr2');
			var req = new xmlHttpRequest();
			let entity = Helpers.createEntity(fileContent, _selectedFile, webResourceType, _prefix);
			req.open("POST", `${_data.OrgInfo.CrmUrl}/api/data/v${_data.OrgInfo.ApiVersion}/webresourceset`);
			req = this.setRequestHeaders(req, "application/json; charset=utf-8");
			req.addEventListener("load", () => {
				let regExp = /\(([^)]+)\)/;
				let matches = regExp.exec(req.getResponseHeader("OData-EntityId"));
				if(matches === undefined || matches === null || matches.length < 1) { return; }
				vscode.window.showInformationMessage("WebResource was uploaded to CRM successfully.");
				this.publishWebResource(matches[1]).then(webresourceId => {
					this.addToSolution(webresourceId);
				});
			}, false);
			vscode.window.showInformationMessage("Uploading webresource...");
			req.send(entity);
		} catch (err) {
			vscode.window.showErrorMessage(`There was an error uploading your WebResource to CRM. Reason: ${err}`);
			console.error(err);
		}
	}

	updateExistingWebResource(existingFile: any, fileContent: any) {
		var entity = { "content": fileContent };
		try {
            let xmlHttpRequest = require('xhr2');
			var req = new xmlHttpRequest();
			req.open("PATCH", `${_data.OrgInfo.CrmUrl}/api/data/v${_data.OrgInfo.ApiVersion}/webresourceset(${existingFile.webresourceid})`);
			req = this.setRequestHeaders(req, "application/json; charset=utf-8");
			req.addEventListener("load", () => {
				vscode.window.showInformationMessage("Resource was uploaded to CRM successfully.");
				if(_data.UploadOptions.AddExistingToSolution === true){
					this.askToAddToSolution(existingFile);
				}
				this.publishWebResource(existingFile.webresourceid);
			}, false);
			vscode.window.showInformationMessage("Updating webresource...");
			req.send(JSON.stringify(entity));
		} catch (err) {	
			vscode.window.showErrorMessage(`There was an error uploading your WebResource to CRM. Reason: ${err}`);
			console.error(err);	
		}
	}

    askToAddToSolution(existingFile: any) {
        vscode.window.showQuickPick(["Yes", "No"], { canPickMany: false, title: "Do you want to add the WebResource to a Solution?" }).then(selected => {
            if (!selected) { return; }
            if (selected === "Yes") {
                this.addToSolution(existingFile.webresourceid);
            }
        }).then(undefined, err => { 
			vscode.window.showErrorMessage("Couldn't add the WebResource to solution.");
			console.error(err);	
		});
    }

    addToSolution(crmId: any) {
		var xmlHttpRequest = require('xhr2');
		var req = new xmlHttpRequest();
		req.open("GET", `${_data.OrgInfo.CrmUrl}/api/data/v${_data.OrgInfo.ApiVersion}/solutions?\$select=friendlyname,solutionid,uniquename&\$filter=ismanaged eq false&\$orderby=friendlyname asc`);
		req = this.setRequestHeaders(req, "application/json; charset=utf-8");
		req.addEventListener("load", () => {
			let solutions = [""];
			let response = JSON.parse(req.response);
			response.value.forEach((element: any) => {
				if(element.uniquename !== "Active" && element.uniquename !== "Default"){
					solutions.push(element.uniquename);
				}
			});
			vscode.window.showQuickPick(solutions, {canPickMany: false, title: "Select Solution to add the Web Resource to."}).then(selected => {
				if(!selected){ return; }
				this.addComponentToSolution(crmId, selected);		
			})
			.then(undefined, err => { 
				vscode.window.showErrorMessage("There was an error getting the solutions");
				console.error(err); });
		}, false);
		req.send();
	}

    addComponentToSolution(crmId: any, selectedSolution: string) {
		let body = Helpers.createAddToSolutionRequestBody(crmId, selectedSolution);
		var xmlHttpRequest = require('xhr2');
		var req = new xmlHttpRequest();

		req.open("POST", `${_data.OrgInfo.CrmUrl}/api/data/v${_data.OrgInfo.ApiVersion}/AddSolutionComponent`);
		req = this.setRequestHeaders(req, "application/json");
		req.addEventListener("load", function() {
			if(req.status === 200){
				vscode.window.showInformationMessage("Component was added to solution successfully.");
			}
			else {
				vscode.window.showErrorMessage("There was an error while adding component to solution.");
			}
		}, false);
		req.send(body);
	}

    getWebResource(data: any) : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let xmlHttpRequest = require('xhr2');
            let req = new xmlHttpRequest();
            req.open("GET", `${data.OrgInfo.CrmUrl}/api/data/v${data.OrgInfo.ApiVersion}/webresourceset?\$select=content,contentjson,displayname,name,webresourceid&\$filter=name eq '${_prefix}${_selectedFile}'`);
            this.getToken(data);
            req = this.setRequestHeaders(req, "application/json; charset=utf-8");
            req.addEventListener("load", () => {
                let foundResources = JSON.parse(req.response);
                resolve(foundResources);
            }, false);
            req.send();
        });
    }

    getToken(data?: any) : Promise<AccessToken> {
        if(_tokenResult.expiresOnTimestamp < Date.now()) {
            return new Promise<AccessToken>((resolve) => {
                this.connection.getToken(`${data.OrgInfo.CrmUrl}/.default`).then(res => {
                    _tokenResult = res;
                    resolve(res);
                });
            });
        }
        else { 
            return new Promise<AccessToken>((resolve) => resolve(_tokenResult));
        }
    }

    setRequestHeaders(req: any, contentType: string){
        req.setRequestHeader("OData-MaxVersion", "4.0");
        req.setRequestHeader("OData-Version", "4.0");
        req.setRequestHeader("Accept", "application/json");
        req.setRequestHeader("Content-Type", contentType);
        req.setRequestHeader("Authorization", "Bearer " + _tokenResult.token);
        return req;
        // req.open, req.send and addeventlistener has to be done in the individual funcitons.
    }

    async publishWebResource(webresourceid: any) : Promise<string> {
		return new Promise((resolve, reject) => {
			/* eslint-disable */
			var parameters = {
				"ParameterXml" : `<importexportxml>
				<webresources>
				<webresource>{`+ webresourceid + `}</webresource>
				</webresources>
				</importexportxml>`
			};
			/* eslint-enable */
			var xmlHttpRequest = require('xhr2');
			var req = new xmlHttpRequest();
			req.open("POST", `${_data.OrgInfo.CrmUrl}/api/data/v${_data.OrgInfo.ApiVersion}/PublishXml`);
			req = this.setRequestHeaders(req, "application/json; charset=utf-8");
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
