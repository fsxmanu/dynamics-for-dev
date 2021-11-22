import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import * as fs from 'fs';
import { DynamicsRequests } from "../connection/dynamics-requests";
import { Helpers } from "../helpers";
import { Mapper } from "../mapping/mapping-file-provider";

export class SolutionExporter {
    _webResourceFolder: string = "";
    _data: any = null;
    _selectedFile: string = "";
    _rootPath: string;
    _connection: DefaultAzureCredential;
    _configFileLocation: string;
    _fullPath : string = "";
    _dynamicsRequest : DynamicsRequests;

    constructor(workSpaceRootPath: string) {
        this._rootPath = Mapper.fixPath(workSpaceRootPath);
        this._connection = new DefaultAzureCredential();
        this._configFileLocation = this._rootPath + '/dynamicsConfig.json';
        this._dynamicsRequest = new DynamicsRequests(this._connection);
    }

    setUpRequiredVariables() {
        return new Promise<void>((resolve, reject) => {
            this.getConfigData();
            if(this._data === null) { reject(); }
            resolve();
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

    async exportSolutionContext(folder: any){
        this._fullPath = Mapper.fixPath(folder.path);
        await this.setUpRequiredVariables();
        if(this._data.Solutions === undefined || this._data.Solutions.length === 0) {
            let solutions = await this.getSolutionFromDynamics("select=uniquename&\$filter=ismanaged eq false");
            vscode.window.showQuickPick(solutions).then(async (solutionName) => {
                if(!solutionName || solutionName === "") { return; }
                let solution = await this.getSolutionFromDynamics(`filter=uniquename eq '${solutionName}'`);
                this.exportSolution(solution);
            });
        }
        else {
            vscode.window.showQuickPick(this._data.Solutions).then((solutionName) => {
                this.getSolutionFromDynamics(`filter=uniquename eq '${solutionName}'`).then (solution => {
                    this.exportSolution(solution);
                });
            });
        }
    }

    exportSolution(solution: any) {
        vscode.window.showInformationMessage("Exporting solution. Please wait...");
        if(solution.length === 0) { 
            vscode.window.showErrorMessage("No Solution found to export");
            return;
        }
        let parameters : any = {};
        parameters.SolutionName = solution[0];
        parameters.Managed = false;

        let xmlHttpRequest = require('xhr2');
        let req = new xmlHttpRequest();
        req.open("POST", `${this._data.OrgInfo.CrmUrl}/api/data/v${this._data.OrgInfo.ApiVersion}/ExportSolution`);
        this._dynamicsRequest.setRequestHeaders(req, "application/json; charset=utf-8").then((response) => {
            req = response;
            req.addEventListener("load", () => {
                let result = JSON.parse(req.response);
                let fullFilePath = this._fullPath + "/" + solution[0] + ".zip";
                fs.writeFileSync(fullFilePath, result.ExportSolutionFile, { encoding: "base64" });
                vscode.window.showInformationMessage("Solution exported successfully");
            }, false);
            req.send(JSON.stringify(parameters));
        });
    }

    getSolutionFromDynamics(filter: string) {
        return new Promise<any>((resolve) => {
            let xmlHttpRequest = require('xhr2');
		    let req = new xmlHttpRequest();
		    req.open("GET", this._data.OrgInfo.CrmUrl + "/api/data/v" + this._data.OrgInfo.ApiVersion + "/solutions?\$" + filter);
		    req = this._dynamicsRequest.setRequestHeaders(req, "application/json; charset=utf-8").then(response => {
                req = response;
                req.addEventListener("load", function() {
                    let solutions : any = [];
                    let response = JSON.parse(req.response);
                    response.value.forEach((element: any) => {
                        solutions.push(element.uniquename);
                    });
                    resolve(solutions);
                }, false);
                req.send();
            });
        });
    }
}