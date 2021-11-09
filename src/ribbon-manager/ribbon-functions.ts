import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import { DynamicsRequests } from "../connection/dynamics-requests";
import * as fs from 'fs';
import { Helpers } from "../helpers";



export class RibbonManager {
    _prefix: string = "";
    _selectedFile: string = "";
    _data: any;
    _connection: DefaultAzureCredential;
    _dynamicsRequest : DynamicsRequests;
    _configFileLocation: string;
    _rootPath : string = "";

    constructor(workSpaceRootPath: string) {
        this._rootPath = workSpaceRootPath;
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
    
    async getRibbonInformation(){
        await this.setUpRequiredVariables();
        vscode.window.showQuickPick(this._data.RibbonEntities, { canPickMany : false }).then((entityName) => {
            if(!entityName) { return; }
            this.getPublisher().then(publisherId => {
                this.createSolution(entityName, publisherId).then(_ => {
                    this.getEntityId(entityName).then(entityId => {
                        let body = Helpers.createAddToSolutionRequestBody(entityId, "DynamicsForDev" + entityName, 1);
                        this._dynamicsRequest.addComponentToSolution(body).then(() => {
                            fs.mkdirSync(this._rootPath + "/tempRibbon");
                            this._dynamicsRequest.exportSolution("DynamicsForDev" + entityName, this._rootPath + "/tempRibbon").then((filePath: any) => {
                                this.readSolutionXml(filePath);
                            });
                        });
                    });
                });
            });
        });
    }

    readSolutionXml(filePath: any) {
        const StreamZip = require('node-stream-zip');
        const zip = new StreamZip({
            file: filePath,
            storeEntries: true
        });

        zip.on('ready', () => {
            // Take a look at the files
            console.log('Entries read: ' + zip.entriesCount);

            // Read a file in memory
            let customizationsXml = zip.entryDataSync('customizations.xml').toString('utf8');

            // Do not forget to close the file once you're done
            zip.close();
        });
    }

    getEntityId(entityName: string){
        return new Promise<any>((resolve, reject) => {
            var xmlHttpRequest = require('xhr2');
            var req = new xmlHttpRequest();
            req.open("GET", this._data.OrgInfo.CrmUrl + "/api/data/v" + this._data.OrgInfo.ApiVersion + "/entities?$select=entityid&$filter=name eq '"+ entityName + "'");
            this._dynamicsRequest.setRequestHeaders(req, "application/json; charset=utf-8").then((response) => {
                req = response;
                req.addEventListener("load", function() {
                    let result = JSON.parse(req.response);
                    resolve(result.value[0].entityid);
                }, false);
                req.send();
            });
        });
    }

    getPublisher() : Promise<any> {
        return new Promise<any>((resolve) => {
            var xmlHttpRequest = require('xhr2');
            var req = new xmlHttpRequest();
            req.open("GET", this._data.OrgInfo.CrmUrl + "/api/data/v" + this._data.OrgInfo.ApiVersion + "/publishers?$select=publisherid,uniquename&$filter=uniquename eq '"+ this._data.OrgInfo.Publisher + "'");
            this._dynamicsRequest.setRequestHeaders(req, "application/json; charset=utf-8").then((response) => {
                req = response;
                req.addEventListener("load", function() {
                    let result = JSON.parse(req.response);
                    resolve(result.value[0].publisherid);
                }, false);
                req.send();
            });
        });
    }

    createSolution(entityName: string, publisherId: any) : Promise<void> {
        return new Promise((resolve, reject) => {
            var entity : any = {};
            entity.uniquename = "DynamicsForDev" + entityName;
            entity.friendlyname = "DynamicsForDev" + entityName;
            entity["publisherid@odata.bind"] = `/publishers(${publisherId})`;
            entity.version = "1.0.0.0";

            var xmlHttpRequest = require('xhr2');
            var req = new xmlHttpRequest();
            req.open("POST", this._data.OrgInfo.CrmUrl + "/api/data/v" + this._data.OrgInfo.ApiVersion + "/solutions");
            this._dynamicsRequest.setRequestHeaders(req, "application/json; charset=utf-8").then((response) => {
                req = response;
                req.addEventListener("load", function() {
                    //let result = JSON.parse(req.response);
                    resolve();
                }, false);
                req.send(JSON.stringify(entity));
            });
        });
    }

    createRetrieveRibbonInfoBody(entityName: string): string{
        /* eslint-disable */
        return JSON.stringify({
            "EntityName": entityName,
            "RibbonLocationFilter": 7
        });
        /* eslint-enable */
    }
}