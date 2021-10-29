export class Helpers {

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