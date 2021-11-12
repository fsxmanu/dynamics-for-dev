import { AccessToken, DefaultAzureCredential } from "@azure/identity";
import * as vscode from "vscode";
import { Helpers } from "../helpers";

let _tokenResult: AccessToken;

export class DynamicsRequests {

    _prefix: string = "";
    _selectedFile: string = "";
    _data: any;
    _connection: DefaultAzureCredential;

    constructor(connection: DefaultAzureCredential) {
        this._connection = connection;
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

    selectSolutionToAdd(solutions: any, fileId: any) {
        vscode.window.showQuickPick(solutions, {canPickMany: false, title: "Select Solution to add the Web Resource to."}).then(selected => {
            if(!selected || selected === ""){ return; }
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

    getWebResource(filter: string) : Promise<any> {
        return new Promise<any>((resolve) => {
            let xmlHttpRequest = require('xhr2');
            let req = new xmlHttpRequest();
            req.open("GET", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset?\$select=content,contentjson,displayname,name,webresourceid&\$${filter}`);
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