import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import * as fs from 'fs';
import { DynamicsRequests } from "../connection/dynamics-requests";
import { Helpers } from "../helpers";

export interface WebResourceRecord {
    [key: string]: string;
}

export class WebResourceDownloader {

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

    downloadWebResourceContext(folder: any) {
        this._fullPath = folder.path;
        this._webResourceFolder = folder.path;
        this.getConfigData();
        if(this._data === null) { return; }
        Helpers.determinePrefix(this._data).then((prefix) => {
            this._prefix = prefix;
            let filter = `filter=startswith(name,'${this._prefix}')`;
            this._dynamicsRequest.getWebResource(filter).then((webResources) => {
                if(webResources.value.length === 0) {
                    vscode.window.showErrorMessage("No webresources found.");
                }
                else {
                    let options = webResources.value.map((w: any) => w.name);
                    let records: WebResourceRecord = {};
                    
                    webResources.value.forEach((w: any) => {
                        records[w.name] = w.content;
                    });
                    this.selectResource(options, records);
                }
            });
        });
    }

    selectResource(options: any, records: any) {
        vscode.window.showQuickPick(options, { canPickMany: false , title: "Please select the webresource to download"}).then(displayName => {
            if(!displayName) { return; }
            let webResourceContent = records[displayName];
            this.createNewWebResourceFile(displayName, webResourceContent);
        });
    }

    createNewWebResourceFile(displayname: string, content: string) {
        const writeData = Buffer.from(content, 'base64');
        let fileName = displayname.replace(/^.*[\\\/]/, '');
        vscode.workspace.fs.writeFile(vscode.Uri.file(this._fullPath + '/' + fileName), writeData);
        vscode.window.showInformationMessage('Created a new webResourceFile');
    }

    setUpRequiredVariables() {
        return new Promise<void>((resolve, reject) => {
            this.getConfigData();
            if(this._data === null) { return; }
            Helpers.determinePrefix(this._data).then((prefix) => {
                this._dynamicsRequest._prefix = prefix;
                this._prefix = prefix;
                resolve();
            });
        });
    }

    getConfigData() {
        var windowsSystemRegex = /(\/[A-Za-z]:\/\w+)/g;
        let match = this._configFileLocation.match(windowsSystemRegex);
        let configPath;
        if(match !== null) {
            configPath = this._configFileLocation.substring(1, this._configFileLocation.length);
        }
        else {
            configPath = this._configFileLocation;
        }
        if(fs.existsSync(configPath)){
            this._dynamicsRequest._data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            this._data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        }
        else {
            vscode.window.showErrorMessage(`No dynamicsConfig.json file was found. Please add one in ${this._rootPath}`);
        }
    }
}
