import * as vscode from "vscode";

export class Helpers {

    static determinePrefix(data: any) : Promise<string> {
        return new Promise<string>((resolve, reject) =>
        {
            let prefixOptions = data.NamingConvention.Prefix;
            if(prefixOptions.length > 1){
                this.getPrefix(data).then((prefix) => {
                resolve(prefix);
                });
            }else {
                resolve(data.NamingConvention.Prefix);
            }
        });
    }

    static getPrefix(data: any): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let prefixOptions = data.NamingConvention.Prefix;
        
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

    static getWebResourceType(webResourceType: string): number {
	    /* eslint-disable */
        let types: {[key: string]: number} = {
            "Html": 1,
            "Css": 2,
            "JavaScript" : 3,
            "XML" : 4,
            "PNG" : 5,
            "JPG" : 6,
            "GIF" : 7,
            "XAP" : 8,
            "XSL" : 9,
            "ICO" : 10,
            "SVG" : 11,
            "RESX" : 12
        };
        return types[webResourceType];
        /* eslint-enable */
    }

    static createEntity(fileContent: any, selectedFileName: string, webResourceType: string, prefix: string) {
        return JSON.stringify({
            "content" : fileContent,
            "displayname" : selectedFileName,
            "name" : prefix + selectedFileName,
            "webresourcetype": Helpers.getWebResourceType(webResourceType)
        });
    }

    static createAddToSolutionRequestBody(crmId: any, selectedSolution: any): string{
        /* eslint-disable */
        return JSON.stringify({
            "ComponentId": crmId,
            "ComponentType": 61,
            "SolutionUniqueName": selectedSolution,
            "AddRequiredComponents": false
        });
        /* eslint-enable */
    }
}