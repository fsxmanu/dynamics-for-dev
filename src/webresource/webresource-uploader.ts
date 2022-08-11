import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import * as fs from 'fs';
import { DynamicsRequests } from "../connection/dynamics-requests";
import { Helpers } from "../helpers";
import { Mapper } from "../mapping/mapping-file-provider";
import { Notification } from "../vscode-notifications/notification-helper";

export class WebResourceUploader {

    _prefix: string = "";
    _webResourceFolder: string = "";
    _data: any = null;
    _selectedFile: string = "";
    _rootPath: string;
    _connection: DefaultAzureCredential;
    _configFileLocation: string;
    _fullPath: string = "";
    _dynamicsRequest: DynamicsRequests;
    _file: any = null;
    static _webResourceTypeMappings = [
        { extensions: ["js"], type: "JavaScript" },
        { extensions: ["htm", "html"], type: "Html" },
        { extensions: ["css"], type: "Css" },
        { extensions: ["xml"], type: "XML" },
        { extensions: ["png"], type: "PNG" },
        { extensions: ["jpg", "jpeg"], type: "JPG" },
        { extensions: ["gif"], type: "GIF" },
        { extensions: ["xap"], type: "XAP" },
        { extensions: ["xsl", "xslt"], type: "XSL" },
        { extensions: ["ico"], type: "ICO" },
        { extensions: ["svg"], type: "SVG" },
        { extensions: ["resx"], type: "RESX " }
    ];

    constructor(workSpaceRootPath: string) {
        this._rootPath = workSpaceRootPath;
        this._connection = new DefaultAzureCredential();
        this._configFileLocation = this._rootPath + '/dynamicsConfig.json';
        this._dynamicsRequest = new DynamicsRequests(this._connection);
    }

    setUpRequiredVariables() {
        return new Promise<void>(async (resolve, reject) => {
            this._dynamicsRequest._data = Mapper.getConfigData(this._configFileLocation);
            this._data = this._dynamicsRequest._data;
            if(this._data === null) { return; }
            this._webResourceFolder = await this.getWebResourceFolder();
            this._prefix = await Helpers.determinePrefix(this._data);
            this._dynamicsRequest._prefix = this._prefix;
            resolve();
        });
    }

    async uploadWebResourceContext(file: any) {
        this._file = file;
        await this.setUpRequiredVariables();
        this._selectedFile = file.path.replace(/^.*[\\\/]/, '');
        this._dynamicsRequest._selectedFile = this._selectedFile;
        this._fullPath = file.path.substring(0, file.path.lastIndexOf("/"));
        if(this._data === null) { return; }
        this.uploadWebResources();
    }

    async uploadWebResource() {
        try {
            await this.setUpRequiredVariables();
            await this.readWebResources();
            this._fullPath = this._rootPath + this._webResourceFolder;
            this.uploadWebResources();
		} catch (err){
            vscode.window.showErrorMessage(`There was an error uploading your web resource. Make sure you have a dynamicsConfig.json file in your root workspace folder. Reason: ${err}`);
            console.log(err);
        }
    }

    async getWebResourceFolder() : Promise<string> {
        return new Promise<string>((resolve) => {
            let folderOptions = this._data.NamingConvention.WebResourceFolder;
            if (folderOptions.length > 1){
                if(this._data.UploadOptions.TryToResolveFilePath) {
                    folderOptions.forEach((fO: any) => {
                        if (this._file.path.includes(fO)) {
                            resolve(fO);
                            return;
                        }
                    });
                }
                this.getWebResourceLocation(this._data.NamingConvention.WebResourceFolder).then(folder => { resolve(folder); });
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
        return new Promise((resolve) => {
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

    async uploadWebResources() {
		try{
            var filter = `filter=name eq '${this._prefix}${this._selectedFile}'`;
            let webResources = await this._dynamicsRequest.getWebResource(filter, "Getting Web Resources");
            if(webResources === undefined || webResources.value === undefined || webResources.value.length === 0) {
                this.askToCreate();
            }
            else {
                this.uploadFile(false, webResources.value[0]);
            }
        } catch (err) {
            Notification.showError(`There was an error getting the web resources. Reason: ${err}`);
            console.log(err);
        }
    }

    async uploadFile(isNew: boolean, existingFile?: any) {
        let fileContent: string;
        let fullPath = Mapper.fixPath(this._fullPath);
		fileContent = fs.readFileSync(`${fullPath}/${this._selectedFile}`, {encoding: 'base64'});
		if(isNew){
            let webResourceType = await this.chooseWebResourceType();
            let match = await this._dynamicsRequest.uploadNewWebResource(webResourceType, fileContent);
            let webResourceId = await this._dynamicsRequest.publishWebResource(match);
            let solutions = await this._dynamicsRequest.getSolutions();
            this._dynamicsRequest.selectSolutionToAdd(solutions, webResourceId);
        }
        else {
            this._dynamicsRequest.updateExistingWebResource(existingFile, fileContent).then(async () => {
                if(this._data.UploadOptions.AddExistingToSolution === true){
                    await this.askToAddToSolution(existingFile);
                }
                await this._dynamicsRequest.publishWebResource(existingFile.webresourceid);
            });
        }
    }

    chooseWebResourceType() {
        return new Promise<string>((resolve, reject) => {
            const autoPickedType = this.autoPickWebResourceType();

            if (!!autoPickedType) {
                resolve(autoPickedType);
                return;
            }

            let webResourceTypes = ["JavaScript", "Html", "Css", "XML", "PNG", "JPG", "GIF", "XAP", "XSL", "ICO", "SVG", "RESX"];
            vscode.window.showQuickPick(webResourceTypes, { canPickMany: false, title: "Please choose the webresource type" }).then(selected => {
                if (!selected) { return; }
                resolve(selected);
            })
                .then(undefined, err => {
                    vscode.window.showErrorMessage("Couldn't choose the webresource type'");
                    console.error(err);
                });
        });
    }

    autoPickWebResourceType() {
        const fileExtension = this._selectedFile.substring(this._selectedFile?.lastIndexOf(".") + 1)?.toLowerCase();
        const mapping = WebResourceUploader._webResourceTypeMappings.find(m => m.extensions.includes(fileExtension));

        return mapping?.type;
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

    async askToAddToSolution(existingFile: any) {
        return new Promise<void>(async (resolve, reject) => {
            let decision = await Notification.showPick(["Yes", "No"], "Do you want to add the WebResource to a Solution?");
            if(decision === null) { Notification.showError("There was an error while deciding if component should be added to solution."); }

            if (decision === "Yes") {
                let solutions = await this._dynamicsRequest.getSolutions();
                this._dynamicsRequest.selectSolutionToAdd(solutions, existingFile.webresourceid);
            }
            resolve();
        });
    }
}
