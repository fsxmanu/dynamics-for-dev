import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import * as fs from 'fs';
import { DynamicsRequests } from "../connection/dynamics-requests";
import { Helpers } from "../helpers";
import { Mapper } from "../mapping/mapping-file-provider";
import { Notification } from "../vscode-notifications/notification-helper";

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
        this._rootPath = Mapper.fixPath(workSpaceRootPath);
        this._connection = new DefaultAzureCredential();
        this._configFileLocation = this._rootPath + '/dynamicsConfig.json';
        this._dynamicsRequest = new DynamicsRequests(this._connection);
    }

    async downloadWebResourceContext(folder: any) {
        this._fullPath = Mapper.fixPath(folder.path);
        this._webResourceFolder = this._fullPath;
        this._dynamicsRequest._data = Mapper.getConfigData(this._configFileLocation);
        this._data = this._dynamicsRequest._data;
        if(this._data === null) { Notification.showError("No dynamicsConfig.json found or it's corrupt"); }
        
        this._prefix = await Helpers.determinePrefix(this._data);
        let webResources = await this._dynamicsRequest.getWebResource( `filter=startswith(name,'${this._prefix}')`);
        if(webResources.value.length === 0) {
            Notification.showError("No webresources found.");
        }
        else {
            let options = webResources.value.map((w: any) => w.name);
            let records: WebResourceRecord = {};
            
            webResources.value.forEach((w: any) => {
                records[w.name] = w.content;
            });
            this.selectResource(options, records);
        }
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
        return new Promise<void>((resolve) => {
            this._dynamicsRequest._data = Mapper.getConfigData(this._configFileLocation);
            this._data = this._dynamicsRequest._data;
            if(this._data === null) { return; }
            Helpers.determinePrefix(this._data).then((prefix) => {
                this._dynamicsRequest._prefix = prefix;
                this._prefix = prefix;
                resolve();
            });
        });
    }
}
