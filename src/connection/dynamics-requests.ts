import { AccessToken, DefaultAzureCredential } from "@azure/identity";
import * as vscode from "vscode";
import { Helpers } from "../helpers";
import { Notification } from "../vscode-notifications/notification-helper";

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
        return new Promise<AccessToken>((resolve) => {
            if(_tokenResult === null || _tokenResult === undefined || _tokenResult.expiresOnTimestamp < Date.now()) {
                this._connection.getToken(`${this._data.OrgInfo.CrmUrl}/.default`).then(res => {
                    _tokenResult = res;
                    resolve(res);
                });
            }
            else { 
                resolve(_tokenResult);
            }
        });
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
            return new Promise<string>(async (resolve) => {
                let xmlHttpRequest = require('xhr2');
                var req = new xmlHttpRequest();
                let entity = Helpers.createEntity(fileContent, this._selectedFile, webResourceType, this._prefix);
                req.open("POST", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset`);
                req = await this.setRequestHeaders(req, "application/json; charset=utf-8");
                req.addEventListener("load", function() {
                    let regExp = /\(([^)]+)\)/;
                    let matches = regExp.exec(req.getResponseHeader("OData-EntityId"));
                    if(matches === undefined || matches === null || matches.length < 1) { return; }
                    Notification.showInfo("WebResource was uploaded to CRM successfully.");
                    resolve(matches[1]);
                }, false);
                Notification.showInfo("Uploading webresource...");
                req.send(entity);
            });
		} catch (err) {
			Notification.showError(`There was an error uploading your WebResource to CRM. Reason: ${err}`);
			console.error(err);
            return new Promise<string>((resolve, reject) => {
                reject(err);
            });
		}
	}

	updateExistingWebResource(existingFile: any, fileContent: any) {
        return new Promise<void>((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: 'Updating webresource...'
            }, async () => {
                await this.updateWebResource(existingFile, fileContent);
                resolve();
            });
        });
	}

    async updateWebResource(existingFile: any, fileContent: any) : Promise<void> {
        return new Promise<void>((resolve, reject) => {
            var entity = { "content": fileContent };
            try {
                let xmlHttpRequest = require('xhr2');
                var req = new xmlHttpRequest();
                req.open("PATCH", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset(${existingFile.webresourceid})`);
                req = this.setRequestHeaders(req, "application/json; charset=utf-8").then(response => {
                    req = response;
                    req.addEventListener("load", function() {
                        resolve();
                    }, false);
                    //Notification.showInfo("Updating webresource...");
                    req.send(JSON.stringify(entity));
                });
            } catch (err) {	
                Notification.showError(`There was an error uploading your WebResource to CRM. Reason: ${err}`);
                console.error(err);	
                reject(err);
            }
        });
    }

    async selectSolutionToAdd(solutions: any, fileId: any) {
        let solution = await Notification.showPick(solutions, "Select Solution to add the Web Resource to.");
        if(solution === null) { Notification.showError("There was an error while selecting solution."); }
        this.addComponentToSolution(fileId, solution);		
    }

    async getSolutions() : Promise<any> {
        return new Promise<any>(async (resolve) => {
            var xmlHttpRequest = require('xhr2');
		    var req = new xmlHttpRequest();
		    req.open("GET", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/solutions?\$select=friendlyname,solutionid,uniquename&\$filter=ismanaged eq false&\$orderby=friendlyname asc`);
		    req = await this.setRequestHeaders(req, "application/json; charset=utf-8");
            req.addEventListener("load", function() {
                let solutions : any = [];
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
	}

    async addComponentToSolution(crmId: any, selectedSolution: string) : Promise<void> {
		return new Promise<void>((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: 'Adding to Solution...'
            }, async () => {
                await this.addComponent(crmId, selectedSolution);
                Notification.showInfo("Added to Solution successfully");
                resolve();
            });
        });
	}

    async addComponent(crmId: any, selectedSolution: string) {
        let body = Helpers.createAddToSolutionRequestBody(crmId, selectedSolution);
		var xmlHttpRequest = require('xhr2');
		var req = new xmlHttpRequest();

		req.open("POST", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/AddSolutionComponent`);
		req = await this.setRequestHeaders(req, "application/json");
        req.addEventListener("load", function() {
            if(req.status === 200){
                Notification.showInfo("Component was added to solution successfully.");
            }
            else {
                Notification.showError(`There was an error while adding component to solution. Reason: ${req.statusText}`);
            }
        }, false);
        req.send(body);
    }

    async getWebResource(filter: string, progressMessage: string) : Promise<any> {
        return new Promise<string>((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: progressMessage
            }, async () => {
                let webResources = await this.getWebResourceRecords(filter);
                resolve(webResources);
            });
        });
    }

    async getWebResourceRecords(filter: string): Promise<any> {
        return new Promise<any>(async (resolve) => {
            let xmlHttpRequest = require('xhr2');
            let req = new xmlHttpRequest();
            req.open("GET", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/webresourceset?\$select=content,contentjson,displayname,name,webresourceid&\$${filter}`);
            req = await this.setRequestHeaders(req, "application/json; charset=utf-8");
            req.addEventListener("load", function() {
                let foundResources = JSON.parse(req.response);
                resolve(foundResources);
            }, false);
            req.send();
        });
    }

    async publishWebResource(webresourceid: any) : Promise<string> {
        return new Promise<string>((resolve, reject) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: 'Publishing component...'
            }, async () => {
                let webResourceId = await this.publishComponent(webresourceid);
                Notification.showInfo("Published successfully");
                resolve(webResourceId);
            });
        });
	}

    async publishComponent(webresourceid: any) : Promise<string> {

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
					resolve(webresourceid);
				}
				else {
					vscode.window.showErrorMessage("There was an error while publishing your component.");
					reject(req.status);
				}
			}, false);
			req.send(JSON.stringify(parameters));
		});
    }
}