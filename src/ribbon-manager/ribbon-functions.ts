import * as vscode from "vscode";
import { DefaultAzureCredential } from "@azure/identity";
import { DynamicsRequests } from "../connection/dynamics-requests";
import * as fs from 'fs';
import { Helpers } from "../helpers";
import { resolve } from "path";
import { Convert, Welcome4 } from '../ribbon-manager/ribbon-model';


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
        const xml2js = require('xml2js');
        let panel = vscode.window.createWebviewPanel('ribbonEditor', "Ribbon Editor", vscode.ViewColumn.One, {});
        const updateWebView = () => {
            panel.webview.html = this.getWebViewContent();
        };
        updateWebView();
        
        return;
        vscode.window.showQuickPick(this._data.RibbonEntities, { canPickMany : false }).then((entityName) => {
            if(!entityName) { return; }
            this.getPublisher().then(publisherId => {
                this.createSolution(entityName, publisherId).then(_ => {
                    this.getEntityId(entityName).then(entityId => {
                        let body = Helpers.createAddToSolutionRequestBody(entityId, "DynamicsForDev" + entityName, 1);
                        this._dynamicsRequest.addComponentToSolution(body).then(() => {
                            fs.mkdirSync(this._rootPath + "/tempRibbon");
                            this._dynamicsRequest.exportSolution("DynamicsForDev" + entityName, this._rootPath + "/tempRibbon").then((filePath: any) => {
                                this.readSolutionXml(filePath).then((customizationsXml) => {
                                    this.getRibbonDefinition(entityName, customizationsXml);
                                });
                            });
                        });
                    });
                });
            });
        });
    }

    getWebViewContent() {
        return `<!DOCTYPE html>
        <html>
        <body>
          <iframe src="${vscode.Uri.parse(this._data.OrgInfo.CrmUrl)}" height="100%" width="100%" title="Iframe Example"></iframe>
        </body>
        </html>`;
    }

    getRibbonDefinition(entityName: string, customizationsXml: any) {
        let url = this._data.OrgInfo.CrmUrl + "/api/data/v" + this._data.OrgInfo.ApiVersion + "/RetrieveEntityRibbon(EntityName='" + entityName + "',RibbonLocationFilter='All')";

        var xmlHttpRequest = require('xhr2');
        var req = new xmlHttpRequest();
        req.open("GET", url);
        this._dynamicsRequest.setRequestHeaders(req, "application/json; charset=utf-8").then((response) => {
            req = response;
            req.addEventListener("load", () => {
                let result = JSON.parse(req.response);
                let fullFilePath = this._rootPath + "/" + "ribbon.zip";
                fs.writeFileSync(fullFilePath, result.CompressedEntityXml, { encoding: "base64" });
                
                const xml2js = require('xml2js');

                // convert XML to JSON
                xml2js.parseString(xml, (err: any, result: any) => {
                    if(err) {
                        throw err;
                    }

                    // `result` is a JavaScript object
                    // convert it to a JSON string
                    const json = JSON.stringify(result, null, 4);

                    // log JSON string
                    console.log(json);
                    
                });
            }, false);
            req.send();
        });
    }

    readSolutionXml(filePath: any) :Promise<any> {
        return new Promise<any>((resolve, reject) => {
            const streamZip = require('node-stream-zip');
            const zip = new streamZip({
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
                resolve(customizationsXml);
            });
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

let xml = `<RibbonDefinitions>
<RibbonDefinition>
  <UI>
    <Ribbon>
      <Tabs Id="Mscrm.Tabs">
        <Tab Id="Mscrm.HomepageGrid.account.MainTab" Command="Mscrm.HomepageGrid.account.MainTab" Title="Accounts" Description="Accounts" Sequence="100">
          <Scaling Id="Mscrm.HomepageGrid.account.MainTab.Scaling">
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.Management.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.Management" Sequence="10" Size="LargeMediumLargeMedium" />
            <MaxSize Id="FieldService.HomepageGrid.account.MainTab.HomeLocationGroup.MaxSize" GroupId="FieldService.HomepageGrid.account.MainTab.HomeLocationGroup" Sequence="10" Size="LargeMedium" />
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.Collaborate.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.Collaborate" Sequence="20" Size="LargeMediumLargeLarge" />
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.Actions.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.Actions" Sequence="30" Size="LargeLargeMediumLarge" />
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.ExportData.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.ExportData" Sequence="40" Size="LargeMediumLarge" />
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.Workflow.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.Workflow" Sequence="50" Size="Large" />
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.Find.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.Find" Sequence="60" Size="Large" />
            <MaxSize Id="Mscrm.HomepageGrid.account.MainTab.OutlookHelp.MaxSize" GroupId="Mscrm.HomepageGrid.account.MainTab.OutlookHelp" Sequence="61" Size="Large" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.ExportData.Scale.1" GroupId="Mscrm.HomepageGrid.account.MainTab.ExportData" Sequence="80" Size="LargeSmallLarge" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Workflow.Scale.2" GroupId="Mscrm.HomepageGrid.account.MainTab.Workflow" Sequence="100" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Actions.Scale.1" GroupId="Mscrm.HomepageGrid.account.MainTab.Actions" Sequence="110" Size="LargeMediumMediumLarge" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Collaborate.Scale.1" GroupId="Mscrm.HomepageGrid.account.MainTab.Collaborate" Sequence="120" Size="LargeSmallLargeSmall" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Management.Scale.1" GroupId="Mscrm.HomepageGrid.account.MainTab.Management" Sequence="130" Size="LargeMediumLargeMedium" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.ExportData.Scale.3" GroupId="Mscrm.HomepageGrid.account.MainTab.ExportData" Sequence="140" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Collaborate.Scale.2" GroupId="Mscrm.HomepageGrid.account.MainTab.Collaborate" Sequence="150" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Actions.Scale.2" GroupId="Mscrm.HomepageGrid.account.MainTab.Actions" Sequence="160" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.MainTab.Management.Scale.2" GroupId="Mscrm.HomepageGrid.account.MainTab.Management" Sequence="170" Size="Popup" />
            <Scale Id="FieldService.HomepageGrid.account.MainTab.HomeLocationGroup.Scale.Popup" GroupId="FieldService.HomepageGrid.account.MainTab.HomeLocationGroup" Sequence="300" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.HomepageGrid.account.MainTab.Groups">
            <Group Id="Mscrm.HomepageGrid.account.MainTab.Management" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.MainTab.Management" Description="$Resources:Ribbon.HomepageGrid.MainTab.Management" Image32by32Popup="/_imgs/ribbon/newrecord32.png" Template="Mscrm.Templates.FourOverflow">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.Management.Controls">
                <Button Id="Mscrm.HomepageGrid.account.NewRecord" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.New" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.New" Command="Mscrm.NewRecordFromGrid" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.New" Alt="$Resources:Ribbon.HomepageGrid.MainTab.New" Image16by16="/_imgs/ribbon/New_16.png" Image32by32="/_imgs/ribbon/newrecord32.png" TemplateAlias="o1" ModernImage="New" />
                <Button Id="Mscrm.HomepageGrid.account.NewRecordForBPFEntity" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.New" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.New" Command="Mscrm.HomepageGrid.NewRecordForBPFEntity" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.New" Alt="$Resources:Ribbon.HomepageGrid.MainTab.New" Image16by16="/_imgs/ribbon/NewRecord_16.png" Image32by32="/_imgs/ribbon/newrecord32.png" TemplateAlias="o1" ModernImage="New" />
                <Button Id="Mscrm.HomepageGrid.account.Edit" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Management.Edit" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Edit" Command="Mscrm.EditSelectedRecord" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.Edit" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Management.Edit" Image16by16="/_imgs/ribbon/Edit_16.png" Image32by32="/_imgs/ribbon/edit32.png" TemplateAlias="o1" ModernImage="Edit" />
                <Button Id="Mscrm.HomepageGrid.account.Activate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Activate" Command="Mscrm.HomepageGrid.Activate" Sequence="30" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" Image16by16="/_imgs/ribbon/Activate_16.png" Image32by32="/_imgs/ribbon/Activate_32.png" TemplateAlias="o2" ModernImage="Activate" />
                <Button Id="Mscrm.HomepageGrid.account.Deactivate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Deactivate" Command="Mscrm.HomepageGrid.Deactivate" Sequence="40" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" Image16by16="/_imgs/ribbon/Deactivate_16.png" Image32by32="/_imgs/ribbon/Deactivate_32.png" TemplateAlias="o2" ModernImage="DeActivate" />
                <Button Alt="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.BookResource.Button.Alt" Command="msdyn.ApplicationRibbon.HomeGrid.BookResource.Command" Description="Book" Id="msdyn.ApplicationRibbon.account.HomeGrid.BookResource.Button" ModernImage="$webresource:msdyn_/fps/Icons/CommandBar/CalendarButton.svg" LabelText="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.BookResource.Button.LabelText" Sequence="45" TemplateAlias="o2" ToolTipTitle="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.BookResource.Button.ToolTipTitle" ToolTipDescription="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.BookResource.Button.ToolTipDescription" />
                <Button Alt="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.RunRoutingRule.Button.Alt" Command="msdyn.ApplicationRibbon.HomeGrid.RunRoutingRule.Command" Description="Apply Routing Rule" Id="msdyn.ApplicationRibbon.account.HomeGrid.RunRoutingRule.Button" LabelText="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.RunRoutingRule.Button.LabelText" Sequence="45" TemplateAlias="o2" Image16by16="$webresource:msdyn_/AnyEntityRoutingRule/_imgs/16_routecase.png" Image32by32="$webresource:msdyn_/AnyEntityRoutingRule/_imgs/16_routecase.png" ToolTipTitle="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.RunRoutingRule.Button.ToolTipTitle" ToolTipDescription="$LocLabels:msdyn.ApplicationRibbon.HomeGrid.RunRoutingRule.Button.ToolTipDescription" ModernImage="RunRoutingRule" />
                <Button Id="Mscrm.HomepageGrid.account.OpenActiveStage" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_OpenActiveStage_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Form.Tooltip.OpenActiveStage" Command="Mscrm.HomepageGrid.OpenActiveStage" Sequence="50" LabelText="$Resources:Ribbon.Form.MainTab.OpenActiveStage" Alt="$Resources:Ribbon.Form.MainTab.OpenActiveStage" Image16by16="/_imgs/ribbon/formdesign16.png" Image32by32="/_imgs/ribbon/EditForm_32.png" TemplateAlias="o2" ModernImage="FormDesign" />
                <SplitButton Id="Mscrm.HomepageGrid.account.DeleteMenu" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_MainTab_Management_Delete_ToolTipTitle" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.HomepageGrid.Tooltip.Delete" Command="Mscrm.HomepageGrid.DeleteSplitButtonCommand" Sequence="50" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Image16by16="/_imgs/ribbon/Delete_16.png" Image32by32="/_imgs/Workplace/remove_32.png" TemplateAlias="o2" ModernImage="Remove">
                  <Menu Id="Mscrm.HomepageGrid.account.DeleteMenu.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.DeleteMenu.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.DeleteMenu.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.Delete" Command="Mscrm.DeleteSelectedRecord" Sequence="50" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_MainTab_Management_Delete_ToolTipTitle" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.HomepageGrid.Tooltip.Delete" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Image16by16="/_imgs/ribbon/Delete_16.png" Image32by32="/_imgs/Workplace/remove_32.png" ModernImage="Remove" />
                        <Button Id="Mscrm.HomepageGrid.account.BulkDelete" Command="Mscrm.HomepageGrid.BulkDelete" Sequence="100" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.BulkDelete" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Management.BulkDelete" ToolTipDescription="$Resources:Ribbon.HomepageGrid.MainTab.Management.BulkDelete.TooltipDescription" Image16by16="/_imgs/ribbon/BulkDelete_16.png" Image32by32="/_imgs/ribbon/BulkDeleteWizard_32.png" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <Button Id="Mscrm.HomepageGrid.account.MergeRecords" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" ToolTipDescription="$Resources:Ribbon.Tooltip.Merge" Command="Mscrm.HomepageGrid.account.MergeRecords" Sequence="59" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" Image16by16="/_imgs/ribbon/MergeRecords_16.png" Image32by32="/_imgs/ribbon/MergeRecords_32.png" TemplateAlias="o3" ModernImage="MergeRecords" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Detect" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.DetectDuplicates" Command="Mscrm.HomepageGrid.DetectDupes" Sequence="60" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect" Image16by16="/_imgs/ribbon/DetectDuplicates_16.png" Image32by32="/_imgs/ribbon/DuplicateDetection_32.png" TemplateAlias="o3">
                  <Menu Id="Mscrm.HomepageGrid.account.Detect.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Detect.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Detect.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.Detect.Selected" Command="Mscrm.HomepageGrid.DetectDupesSelected" Sequence="10" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.Selected" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.Selected" Image16by16="/_imgs/ribbon/DeleteSelected_16.png" Image32by32="/_imgs/ribbon/DeleteSelected_32.png" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_MainTab_Management_Detect_Selected_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_HomepageGrid_Other_MainTab_Management_Detect_Selected_ToolTipDescription" />
                        <Button Id="Mscrm.HomepageGrid.account.Detect.All" Command="Mscrm.HomepageGrid.DetectDupesAll" Sequence="20" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.All" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.All" Image16by16="/_imgs/ribbon/DetectAll_16.png" Image32by32="/_imgs/ribbon/DetectAll_32.png" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_MainTab_Management_Detect_All_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_HomepageGrid_EntityLogicalName_MainTab_Management_Detect_All_ToolTipDescription" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.ChangeDataSetControlButton" ToolTipTitle="$Resources:MobileClient.Commands.ChangeControl" ToolTipDescription="$Resources:WebClient.Commands.ChangeControl.Description" Command="Mscrm.ChangeControlCommand" Sequence="25" LabelText="$Resources:MobileClient.Commands.ChangeControl" Alt="$Resources:WebClient.Commands.ChangeControl.Description" Image16by16="/_imgs/ribbon/SendView_16.png" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.ChangeControlCommand" TemplateAlias="o1" />
                <Button Alt="$LocLabels:GuidedHelp.Alt" Command="loadGuidedHelp" Description="Learning Path" Id="GuidedHelpaccount.Grid" LabelText="$LocLabels:GuidedHelp.LabelText" Sequence="70" TemplateAlias="o3" ToolTipTitle="$LocLabels:GuidedHelp.ToolTipTitle" ToolTipDescription="$LocLabels:GuidedHelp.ToolTipDescription" />
                <Button Alt="$LocLabels:LPLibrary.Alt" Command="launchLPLibrary" Description="Learning Path Library" Id="LPLibraryaccount.Grid" LabelText="$LocLabels:LPLibrary.LabelText" Sequence="80" TemplateAlias="o3" ToolTipTitle="$LocLabels:LPLibrary.ToolTipTitle" ToolTipDescription="$LocLabels:LPLibrary.ToolTipDescription" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.MainTab.ModernClient" Command="Mscrm.Enabled" Sequence="11" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.ModernClient.Controls">
                <Button Id="Mscrm.HomepageGrid.account.RefreshModernButton" ToolTipTitle="$Resources:MobileClient.Commands.Refresh" Command="Mscrm.Modern.refreshCommand" ModernCommandType="ControlCommand" Sequence="17" LabelText="$Resources:MobileClient.Commands.Refresh" ModernImage="Refresh" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.NavigateToHomepageGrid" ToolTipTitle="$Resources:OpenAllRecordsViewImageButtonText" ToolTipDescription="$Resources:OpenAllRecordsViewImageButtonToolTip" Command="Mscrm.NavigateToHomepageGrid" Sequence="18" LabelText="$Resources:OpenAllRecordsViewImageButtonText" ModernImage="TableGroup" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.ActionButtonForMSTeams" Command="Mscrm.HomePageGrid.MSTeamsViewCollaborateCommand" ToolTipTitle="$LocLabels:OfficeProductivity.MSTeamsToolTip" ToolTipDescription="$LocLabels:OfficeProductivity.MSTeamsToolTip" LabelText="$LocLabels:OfficeProductivity.MSTeams" Alt="$LocLabels:OfficeProductivity.MSTeams" TemplateAlias="o2" Sequence="1028" ModernImage="MSTeamsIcon" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.MainTab.Actions" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.MainTab.Actions" Template="Mscrm.Templates.Flexible4" Image32by32Popup="/_imgs/ribbon/Actions_32.png">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.Actions.Controls">
                <Button Sequence="10" Id="msdyn.HomepageGrid.account.LaunchPlaybook.Button" TemplateAlias="o1" ModernImage="$webresource:Playbook/msdyn_/Images/SVG/PlaybookInstanceIcon.svg" LabelText="$LocLabels:Ribbon.Form.LaunchPlaybook.Button.LabelText" Alt="$LocLabels:Ribbon.Form.LaunchPlaybook.Button.LabelText" Command="Playbook.HomepageGrid.Launch" ToolTipTitle="$LocLabels:Ribbon.Form.LaunchPlaybook.Button.LabelText" ToolTipDescription="$LocLabels:Ribbon.ToolTip.LaunchPlabyook" />
                <Button Sequence="10" Id="msdyn.HomepageGrid.account.ApplyCadence.Button" TemplateAlias="o1" ModernImage="Convert" LabelText="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" Alt="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" Command="Mscrm.HomepageGrid.Cadence.Apply" ToolTipTitle="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" ToolTipDescription="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" />
                <Button Sequence="10" Id="msdyn.HomepageGrid.account.DisconnectSequence.Button" TemplateAlias="o1" ModernImage="Cancel" LabelText="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" Alt="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" Command="Mscrm.HomepageGrid.Sequence.Disconnect" ToolTipTitle="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" ToolTipDescription="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" />
                <Button Id="Mscrm.HomepageGrid.account.ViewOrgChart" Command="LinkedInExtensions.ViewOrgChartForGrid" Sequence="52" Alt="$LocLabels:Mscrm.Form.account.ViewOrgChart" LabelText="$LocLabels:Mscrm.Form.account.ViewOrgChart" ToolTipTitle="$LocLabels:Mscrm.Form.account.ViewOrgChart.ToolTipTitle" ToolTipDescription="$LocLabels:Mscrm.Form.account.ViewOrgChart.ToolTipDesc" ModernImage="Drilldown" />
              </Controls>
            </Group>
            <Group Id="FieldService.HomepageGrid.account.MainTab.HomeLocationGroup" Command="Mscrm.Enabled" Template="Mscrm.Templates.Flexible2" Sequence="25" Title="$LocLabels:FieldService.HomepageGrid.account.MainTab.HomeLocationGroup.TitleText" Description="$LocLabels:FieldService.HomepageGrid.account.MainTab.HomeLocationGroup.DescriptionText">
              <Controls Id="FieldService.HomepageGrid.account.MainTab.HomeLocationGroup.Controls">
                <Button Id="FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM" Command="FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.Command" Sequence="20" ToolTipTitle="$LocLabels:FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.LabelText" LabelText="$LocLabels:FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.LabelText" ToolTipDescription="$LocLabels:FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.Description" TemplateAlias="o1" ModernImage="$webresource:msdyn_/Icons/CommandBar/GeoCode.svg" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.MainTab.Collaborate" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.MainTab.Collaborate" Image32by32Popup="/_imgs/ribbon/Assign_32.png" Template="Mscrm.Templates.Flexible4">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.Collaborate.Controls">
                <Button Id="Mscrm.HomepageGrid.account.SendDirectEmail" Command="Mscrm.AddEmailToSelectedRecord" Sequence="10" ToolTipTitle="$Resources:Ribbon.HomepageGrid.SendDirectEmail.ToolTip" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.DirectEmail" LabelText="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Alt="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Image16by16="/_imgs/ribbon/AddEmail_16.png" Image32by32="/_imgs/ribbon/Email_32.png" TemplateAlias="o1" ModernImage="EmailLink" />
                <Button Id="Mscrm.HomepageGrid.account.modern.SendDirectEmail" Command="Mscrm.modern.AddEmailToSelectedRecord" Sequence="10" ToolTipTitle="$Resources:Ribbon.HomepageGrid.SendDirectEmail.ToolTip" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.DirectEmail" LabelText="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Alt="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Image16by16="/_imgs/ribbon/AddEmail_16.png" Image32by32="/_imgs/ribbon/Email_32.png" TemplateAlias="o1" ModernImage="EmailLink" />
                <Button ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.QuickPowerBI.ToolTip" ToolTipDescription="$Resources:Ribbon.HomepageGrid.MainTab.QuickPowerBI.ToolTipDescription" Command="Mscrm.HomepageGrid.MainTab.QuickPowerBI.Command" Id="Mscrm.HomepageGrid.account.MainTab.QuickPowerBI.Button" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.QuickPowerBI.Name" Sequence="10" TemplateAlias="o2" ModernImage="$webresource:PowerBI.svg" />
                <Button Id="Mscrm.HomepageGrid.account.AddToList" ToolTipTitle="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.AddToMarketingList" Command="Mscrm.AddSelectedToMarketingList" Sequence="11" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" Image16by16="$webresource:Marketing/_images/ribbon/AddToMarketingList_16.png" Image32by32="$webresource:Marketing/_images/ribbon/AddToMarketingList_32.png" TemplateAlias="o1" ModernImage="BulletListAdd" />
                <Button Id="Mscrm.HomepageGrid.account.Assign" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Assign" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Assign" Command="Mscrm.AssignSelectedRecord" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Assign" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Assign" Image16by16="/_imgs/ribbon/Assign_16.png" Image32by32="/_imgs/ribbon/Assign_32.png" TemplateAlias="o1" ModernImage="Assign" />
                <Button Id="Mscrm.HomepageGrid.account.Sharing" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Share" Command="Mscrm.ShareSelectedRecord" Sequence="50" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" Image16by16="/_imgs/ribbon/Share_16.png" Image32by32="/_imgs/ribbon/Sharing_32.png" TemplateAlias="o2" ModernImage="Share" />
                <Button Id="Mscrm.HomepageGrid.account.ViewHierarchy" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.ViewHierarchy" ToolTipDescription="$Resources:Mscrm_MainTab_Actions_ViewHierarchy_ToolTipDescription" Command="Mscrm.ViewHierarchyForSelectedRecord" Sequence="55" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.ViewHierarchy" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.ViewHierarchy" Image16by16="/_imgs/Hierarchy.png" Image32by32="/_imgs/ribbon/Hierarchy_32.png" TemplateAlias="o1" ModernImage="ViewHierarchy" />
                <SplitButton Id="Mscrm.HomepageGrid.account.Copy" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" ToolTipDescription="$Resources:Mscrm_HomepageGrid_Other_MainTab_ExportData_Copy_ToolTipDescription" Command="Mscrm.CopyShortcutSelected.EnabledInIEBrowser" Sequence="60" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" Image16by16="/_imgs/ribbon/Copy_16.png" Image32by32="/_imgs/ribbon/Copy_32.png" TemplateAlias="o2">
                  <Menu Id="Mscrm.HomepageGrid.account.Copy.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Copy.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Copy.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.Copy.Selected" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Selected" ToolTipDescription="$Resources:Mscrm_HomepageGrid_Other_MainTab_ExportData_Copy_Selected_ToolTipDescription" Command="Mscrm.CopyShortcutSelected" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Selected" Image16by16="/_imgs/ribbon/copyshortcut16.png" Image32by32="/_imgs/ribbon/copyshortcut32.png" />
                        <Button Id="Mscrm.HomepageGrid.account.Copy.View" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.View" ToolTipDescription="$Resources:Ribbon.Tooltip.CopyShortcut_View" Command="Mscrm.CopyShortcutView" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.View" Image16by16="/_imgs/ribbon/CopyView_16.png" Image32by32="/_imgs/ribbon/CopyView_32.png" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <Button Command="Entity.btnAddtoconfiguration.Command" Id="Entity.account.btnAddtoconfiguration" LabelText="$LocLabels:Entity.btnAddtoconfiguration.LabelText" Sequence="60" TemplateAlias="o2" ToolTipTitle="$LocLabels:Entity.btnAddtoconfiguration.ToolTipTitle" ToolTipDescription="$LocLabels:Entity.btnAddtoconfiguration.ToolTipDescription" Image16by16="$webresource:msdyusd_AddToConfig_16" Image32by32="$webresource:msdyusd_AddToConfig_32" />
                <SplitButton Id="Mscrm.HomepageGrid.account.Send" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" ToolTipDescription="$Resources:Mscrm_HomepageGrid_Other_MainTab_ExportData_Send_ToolTipDescription" Command="Mscrm.SendShortcutSelected.AlwaysEnabled" Sequence="61" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" Image16by16="/_imgs/ribbon/EmailLink_16.png" Image32by32="/_imgs/ribbon/SendShortcut_32.png" TemplateAlias="o2" ModernImage="EmailLink">
                  <Menu Id="Mscrm.HomepageGrid.account.Send.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Send.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Send.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.Send.Selected" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Selected" ToolTipDescription="$Resources:Ribbon.Tooltip.SendShortcut" Command="Mscrm.SendShortcutSelected" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Selected" Image16by16="/_imgs/ribbon/EmailLink_16.png" Image32by32="/_imgs/ribbon/SendShortcut_32.png" ModernImage="EmailLink" />
                        <Button Id="Mscrm.HomepageGrid.account.Send.View" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.View" ToolTipDescription="$Resources:Ribbon.Tooltip.SendShortcut_View" Command="Mscrm.SendShortcutView" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.View" Image16by16="/_imgs/ribbon/SendView_16.png" Image32by32="/_imgs/ribbon/SendView_32.png" ModernImage="EmailLink" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <SplitButton Id="Mscrm.HomepageGrid.account.AddConnection" ToolTipTitle="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" ToolTipDescription="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Tooltip" Command="Mscrm.AddConnectionGrid" Sequence="70" LabelText="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" Alt="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" Image16by16="/_imgs/ribbon/AddConnection_16.png" Image32by32="/_imgs/ribbon/AddConnection_32.png" TemplateAlias="o3" ModernImage="Connection">
                  <Menu Id="Mscrm.HomepageGrid.account.AddConnection.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.AddConnection.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.AddConnection.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.AddConnectionNew" ToolTipTitle="$Resources:Ribbon.Connection.AddConnectionNew.Label" ToolTipDescription="$Resources:Ribbon.Connection.AddConnectionNew.Tooltip" Command="Mscrm.AddConnectionGrid" Sequence="40" LabelText="$Resources:Ribbon.Connection.AddConnectionNew.Label" Alt="$Resources:Ribbon.Connection.AddConnectionNew.Label" ModernImage="ConnectionToOther" />
                        <Button Id="Mscrm.HomepageGrid.account.AddConnectionToMe" ToolTipTitle="$Resources:Ribbon.Connection.AddConnectionToMe.Label" ToolTipDescription="$Resources:Ribbon.Connection.AddConnectionToMe.Tooltip" Command="Mscrm.AddConnectionToMeGrid" Sequence="41" LabelText="$Resources:Ribbon.Connection.AddConnectionToMe.Label" Alt="$Resources:Ribbon.Connection.AddConnectionToMe.Label" ModernImage="ConnectionToMe" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <Button Id="Mscrm.HomepageGrid.account.AddToQueue" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" ToolTipDescription="$Resources(EntityPluralDisplayName):Mscrm_HomepageGrid_EntityLogicalName_MainTab_Actions_AddToQueue_ToolTipDescription" Command="Mscrm.AddSelectedToQueue" Sequence="80" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" Image16by16="/_imgs/ribbon/AddToQueue_16.png" Image32by32="/_imgs/ribbon/AddToQueue_32.png" TemplateAlias="o3" ModernImage="AddToQueue" />
                <Button Id="Mscrm.HomepageGrid.account.FollowButton" Command="Mscrm.HomepageGrid.FollowCommand" ToolTipTitle="$LocLabels:ActivityFeed.Follow.ToolTipTitle" ToolTipDescription="$LocLabels:ActivityFeed.Follow.ToolTipDescription" LabelText="$LocLabels:ActivityFeed.Follow.LabelText" TemplateAlias="o2" Image16by16="/_imgs/ribbon/Entity16_8003.png" Image32by32="/_imgs/ribbon/Entity32_8003.png" Sequence="1000" ModernImage="RatingEmpty" />
                <Button Id="Mscrm.HomepageGrid.account.UnfollowButton" Command="Mscrm.HomepageGrid.UnfollowCommand" ToolTipTitle="$LocLabels:ActivityFeed.Unfollow.ToolTipTitle" ToolTipDescription="$LocLabels:ActivityFeed.Unfollow.ToolTipDescription" LabelText="$LocLabels:ActivityFeed.Unfollow.LabelText" TemplateAlias="o2" Image16by16="/_imgs/ribbon/Entity16_8003_u.png" Image32by32="/_imgs/ribbon/Entity32_8003_u.png" Sequence="1020" ModernImage="RatingFull" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.MainTab.Workflow" Command="Mscrm.Enabled" Sequence="40" Title="$Resources:Ribbon.HomepageGrid.Data.Workflow" Image32by32Popup="/_imgs/ribbon/runworkflow32.png" Template="Mscrm.Templates.Flexible">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.Workflow.Controls">
                <Button Id="Mscrm.HomepageGrid.account.RunWorkflow" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunWorkflow" Command="Mscrm.RunWorkflowSelected" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" Alt="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" Image16by16="/_imgs/ribbon/StartWorkflow_16.png" Image32by32="/_imgs/ribbon/runworkflow32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.RunScript" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunScript" Command="Mscrm.RunInteractiveWorkflowSelected" Sequence="50" LabelText="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" Alt="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" Image16by16="/_imgs/ribbon/startdialog_16.png" Image32by32="/_imgs/ribbon/startdialog_32.png" TemplateAlias="o1" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar" Sequence="60" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunFlow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunFlow" Command="Mscrm.Form.Flows.ManageRunFlow" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.Flows" Alt="$Resources:RefreshCommandBar.Flows" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Grid.Flows.PopulateMenu" TemplateAlias="o1" ModernImage="Flows" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.Flows" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.Flows" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Flows" Sequence="70" Command="Mscrm.Form.Flows" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.Flows" Alt="$Resources:RefreshCommandBar.Flows" TemplateAlias="o1" ModernImage="Flows">
                  <Menu Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.Flows.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.Flows.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.Flows.Controls">
                        <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.ManageFlows" Sequence="10" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.ManageFlows" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.ManageFlows" Command="Mscrm.Form.Flows" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.ManageFlows" Alt="$Resources:RefreshCommandBar.ManageFlows" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Grid.Flows.PopulateStaticFlowMenu" TemplateAlias="o1" ModernImage="Flows" />
                        <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.RunFlow" Sequence="20" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunFlow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunFlow" Command="Mscrm.Form.Flows" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.RunFlow" Alt="$Resources:RefreshCommandBar.RunFlow" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Grid.Flows.PopulateFlowMenu" TemplateAlias="o1" ModernImage="Flows" />
                        <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Flows.RefreshCommandBar.RunWorkflow" Sequence="30" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunWorkflow" Command="Mscrm.Form.Flows.RunWorkflow" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.RunWorkflow" Alt="$Resources:RefreshCommandBar.RunWorkflow" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Grid.Flows.PopulateWorkFlowMenu" TemplateAlias="o1" ModernImage="Flows" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
                <FlyoutAnchor Id="AIBuilder.account.Flyout.Dummy" Command="Mscrm.Disabled" LabelText="AIBuilder Hidden">
                  <Menu Id="AIBuilder.account.Flyout.Menu.Dummy">
                    <MenuSection Id="AIBuilder.account.Flyout.Menu.MenuSection.Dummy">
                      <Controls Id="AIBuilder.account.Flyout.Menu.MenuSection.Controls.Dummy">
                        <Button Id="AIBuilder.account.Flyout.Menu.MenuSection.Controls.CreateModel.Dummy" Command="AIBuilder.Command.CreateModel" LabelText="$LocLabels:AIBuilder.Flyout.Menu.MenuSection.Controls.CreateModel.Label" ToolTipTitle="$LocLabels:AIBuilder.Flyout.Menu.MenuSection.Controls.CreateModel.Tooltip" ModernImage="$webresource:msdyn_AIBuilder.svg" />
                        <Button Id="AIBuilder.account.Flyout.Menu.MenuSection.Controls.SeeModels.Dummy" Command="AIBuilder.Command.SeeModels" LabelText="$LocLabels:AIBuilder.Flyout.Menu.MenuSection.Controls.SeeModels.Label" ToolTipTitle="$LocLabels:AIBuilder.Flyout.Menu.MenuSection.Controls.SeeModels.Tooltip" ModernImage="$webresource:msdyn_AIBuilder.svg" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
                <FlyoutAnchor Id="AIBuilder.account.Flyout" Command="AIBuilder.Command.Flyout" PopulateDynamically="true" PopulateQueryCommand="AIBuilder.Command.PopulateFlyoutMenu" LabelText="$LocLabels:AIBuilder.Flyout.Label" ToolTipTitle="$LocLabels:AIBuilder.Flyout.Label.ToolTip" ModernImage="$webresource:msdyn_AIBuilder.svg" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.MainTab.ExportData" Command="Mscrm.Enabled" Sequence="50" Title="$Resources:Ribbon.HomepageGrid.MainTab.ExportData" Image32by32Popup="/_imgs/ribbon/runreport32.png" Template="Mscrm.Templates.Flexible3">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.ExportData.Controls">
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.RunReport" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" ToolTipDescription="$Resources:Ribbon.Tooltip.RunReport" Command="Mscrm.ReportMenu.Grid" PopulateDynamically="true" PopulateOnlyOnce="false" PopulateQueryCommand="Mscrm.ReportsMenu.Populate.Grid" Sequence="30" LabelText="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" Alt="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" Image16by16="/_imgs/ribbon/RunReport_16.png" Image32by32="/_imgs/ribbon/runreport32.png" TemplateAlias="o1" ModernImage="Report" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.DocumentTemplate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.DocumentTemplate.Templates" ToolTipDescription="$Resources:Ribbon.Tooltip.DocumentTemplate" Command="Mscrm.DocumentTemplate.Templates" PopulateDynamically="true" PopulateOnlyOnce="false" PopulateQueryCommand="Mscrm.DocumentTemplate.Populate.Flyout" Sequence="35" LabelText="$Resources:Ribbon.HomepageGrid.Data.DocumentTemplate.Templates" Alt="$Resources:Ribbon.HomepageGrid.Data.DocumentTemplate.Templates" Image16by16="/_imgs/ribbon/DocumentTemplate_16.png" Image32by32="/_imgs/ribbon/SaveAsExcelTemplate_32.png" TemplateAlias="o1" ModernImage="DocumentTemplates" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.WordTemplate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" ToolTipDescription="$Resources:Ribbon.Tooltip.WordTemplate" Command="Mscrm.HomepageGrid.WordTemplate" PopulateDynamically="true" PopulateOnlyOnce="false" PopulateQueryCommand="Mscrm.HomepageGrid.WordTemplate.Populate.Flyout" Sequence="36" LabelText="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" Alt="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" Image16by16="/_imgs/ribbon/WordTemplate_16.png" Image32by32="/_imgs/ribbon/SaveAsWordTemplate_32.png" TemplateAlias="o1" ModernImage="WordTemplates" />
                <SplitButton Id="Mscrm.HomepageGrid.account.ExportToExcel" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.ExportToExcel" ToolTipDescription="$Resources:Ribbon.Tooltip.ExportToExcel" Command="Mscrm.ExportToExcel" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.ExportToExcel" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.ExportToExcel" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" TemplateAlias="o3" ModernImage="ExportToExcel">
                  <Menu Id="Mscrm.HomepageGrid.account.ExportToExcel.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.ExportToExcel.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.ExportToExcel.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.ExportToExcelOnline" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.ExportToExcelOnline" ToolTipDescription="$Resources:Ribbon.Tooltip.ExportToExcelOnline" Command="Mscrm.ExportToExcel.Online" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.ExportToExcelOnline" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.ExportToExcelOnline" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                        <Button Id="Mscrm.HomepageGrid.account.StaticWorksheetAll" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExportAll" ToolTipDescription="$Resources:Ribbon.Tooltip.StaticExcelExportAll" Command="Mscrm.ExportToExcel.AllStaticXlsx" Sequence="41" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExportAll" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExportAll" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                        <Button Id="Mscrm.HomepageGrid.account.StaticWorksheet" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" ToolTipDescription="$Resources:Ribbon.Tooltip.StaticExcelExport" Command="Mscrm.ExportToExcel.StaticXlsx" Sequence="42" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                        <Button Id="Mscrm.HomepageGrid.account.DynamicWorkesheet" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicExcelExport" ToolTipDescription="$Resources:Ribbon.Tooltip.DynamicExcelExport" Command="Mscrm.ExportToExcel.DynamicXlsx" Sequence="43" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicExcelExport" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicExcelExport" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                        <Button Id="Mscrm.HomepageGrid.account.DynamicPivotTable" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicPivotTable" ToolTipDescription="$Resources:Ribbon.Tooltip.DynamicPivotTable" Command="Mscrm.ExportToExcel.PivotXlsx" Sequence="44" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicPivotTable" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicPivotTable" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <Button Id="Mscrm.HomepageGrid.account.ExportSelectedToExcel" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.ExportSelectedToExcel" ToolTipDescription="$Resources:Ribbon.Tooltip.ExportSelectedToExcel" Command="Mscrm.ExportSelectedToExcel" Sequence="230" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.ExportSelectedToExcel" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.ExportSelectedToExcel" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" TemplateAlias="o3" ModernImage="ExportToExcel" />
                <SplitButton Id="Mscrm.HomepageGrid.account.ImportDataFromExcel" Command="Mscrm.ImportDataFromExcel" Sequence="21" LabelText="$Resources:MobileClient.Commands.ImportFromExcel" ToolTipTitle="$Resources:MobileClient.Commands.ImportFromExcel" ToolTipDescription="$Resources:Ribbon.Tooltip.ImportFromExcel" ModernImage="ExportToExcel" TemplateAlias="o2">
                  <Menu Id="Mscrm.HomepageGrid.account.ImportDataFromExcel.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.ImportDataFromExcel.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.ImportDataFromExcel.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.ImportDataFromCSV" Command="Mscrm.ImportDataFromCSV" Sequence="10" LabelText="$Resources:MobileClient.Commands.ImportFromCSV" ToolTipTitle="$Resources:MobileClient.Commands.ImportFromCSV" ToolTipDescription="$Resources:Ribbon.Tooltip.ImportFromCSV" ModernImage="ExportToExcel" />
                        <Button Id="Mscrm.HomepageGrid.account.ImportDataFromXML" Command="Mscrm.ImportDataFromXML" ToolTipTitle="$LocLabels:AppCommon.ImportDataFromXML" ToolTipDescription="$LocLabels:AppCommon.ImportDataFromXMLToolTip" LabelText="$LocLabels:AppCommon.ImportDataFromXML" Alt="$LocLabels:AppCommon.ImportDataFromXML" ModernImage="ExportToExcel" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <SplitButton Id="Mscrm.HomepageGrid.account.Import" ToolTipTitle="$Resources:Mscrm_BasicHomeTab_Tools_ImportData_ToolTipTitle" ToolTipDescription="$Resources:Ribbon.Tooltip.ImportDataSplitButton" Command="Mscrm.ImportDataSplitButton" Sequence="50" LabelText="$Resources:Ribbon.Jewel.ImportData" Alt="$Resources:Ribbon.Jewel.ImportData" Image16by16="/_imgs/ribbon/Import16.png" Image32by32="/_imgs/ribbon/importdata32.png" TemplateAlias="o1">
                  <Menu Id="Mscrm.HomepageGrid.account.Import.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Import.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Import.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.ImportData" ToolTipTitle="$Resources:Mscrm_BasicHomeTab_Tools_ImportData_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_BasicHomeTab_Tools_ImportData_ToolTipDescription" Command="Mscrm.ImportData" Sequence="10" LabelText="$Resources:Ribbon.Jewel.ImportData" Alt="$Resources:Ribbon.Jewel.ImportData" Image16by16="/_imgs/ribbon/ImportData_16.png" Image32by32="/_imgs/ribbon/importdata32.png" />
                        <Button Id="Mscrm.HomepageGrid.account.ExportTemplate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.ExportDataTemplate" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.ExportDataTemplate" Command="Mscrm.ExportDataTemplate" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.ExportDataTemplate" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.ExportDataTemplate" Image16by16="/_imgs/ribbon/ExportTemplate_16.png" Image32by32="/_imgs/ribbon/ExportTemplate_32.png" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <ToggleButton Id="Mscrm.HomepageGrid.account.MainFilters" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Filters.Filters" ToolTipDescription="$Resources:Ribbon.Tooltip.Filters" Command="Mscrm.Filters" QueryCommand="Mscrm.Filters.Query" Sequence="60" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.Filters" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.FiltersToolTip" Image16by16="/_imgs/ribbon/filter16.png" Image32by32="/_imgs/ribbon/filter32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.HomepageGrid.account.AdvancedFind" Command="Mscrm.OpenGridAdvancedFind" Sequence="70" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Find.AdvancedFind" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Find.AdvancedFind" ToolTipDescription="$Resources:Ribbon.HomepageGrid.AdvancedFind.TooltipDescription" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Find.AdvancedFind" Image16by16="/_imgs/ribbon/AdvancedFind_16.png" Image32by32="/_imgs/ribbon/advancedfind32.png" TemplateAlias="o3" />
                <Button Id="Mscrm.HomepageGrid.account.Meqf" Command="Mscrm.OpenMultipleEntityQuickFindSearch" Sequence="80" LabelText="$Resources:Search_LaunchButton_Tooltip" ToolTipTitle="$Resources:Search_LaunchButton_Tooltip" ToolTipDescription="$Resources:Ribbon.HomepageGrid.MultipleEntityQuickFind.TooltipDescription" Alt="$Resources:Search_LaunchButton_Tooltip" Image16by16="/_imgs/search_normal.gif" Image32by32="/_imgs/search_normal.gif" TemplateAlias="o4" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.MainTab.OutlookHelp" Command="Mscrm.OutlookHelp" Sequence="70" Title="$Resources:Ribbon.Jewel.HelpMenu" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.MainTab.OutlookHelp.Controls">
                <Button Id="Mscrm.HomepageGrid.account.Help" ToolTipTitle="$Resources:Ribbon.Jewel.HelpMenu" ToolTipDescription="$Resources:Mscrm_Jewel_Help_Flyout_ToolTipDescription" Command="Mscrm.OutlookHelp" Sequence="10" LabelText="$Resources:Ribbon.Jewel.HelpMenu" Image16by16="/_imgs/ribbon/Help_16.png" Image32by32="/_imgs/ribbon/Help_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.HomepageGrid.account.View" Command="Mscrm.HomepageGrid.account.View" Title="$Resources:Ribbon.HomepageGrid.View.TabName" Description="$Resources:Ribbon.HomepageGrid.View.TabName" Sequence="110">
          <Scaling Id="Mscrm.HomepageGrid.account.View.Scaling">
            <MaxSize Id="Mscrm.HomepageGrid.account.View.Grid.MaxSize" GroupId="Mscrm.HomepageGrid.account.View.Grid" Sequence="10" Size="LargeLarge" />
            <MaxSize Id="Mscrm.HomepageGrid.account.View.Refresh.MaxSize" GroupId="Mscrm.HomepageGrid.account.View.Refresh" Sequence="20" Size="Large" />
            <Scale Id="Mscrm.HomepageGrid.account.View.Grid.Scale.1" GroupId="Mscrm.HomepageGrid.account.View.Grid" Sequence="30" Size="LargeMedium" />
            <Scale Id="Mscrm.HomepageGrid.account.View.Grid.Scale.2" GroupId="Mscrm.HomepageGrid.account.View.Grid" Sequence="40" Size="LargeSmall" />
            <Scale Id="Mscrm.HomepageGrid.account.View.Grid.Scale.3" GroupId="Mscrm.HomepageGrid.account.View.Grid" Sequence="50" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.View.Refresh.Scale.1" GroupId="Mscrm.HomepageGrid.account.View.Refresh" Sequence="60" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.HomepageGrid.account.View.Groups">
            <Group Id="Mscrm.HomepageGrid.account.View.Grid" Command="Mscrm.FiltersGroup" Sequence="11" Title="$Resources:Ribbon.HomepageGrid.View.Grid" Image32by32Popup="/_imgs/ribbon/setasdefaultview32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.HomepageGrid.account.View.Grid.Controls">
                <Button Id="Mscrm.HomepageGrid.account.SaveAsDefaultGridView" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_View_Filters_SaveAsDefaultGridView_ToolTipTitle" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveAsDefaultGridView" Command="Mscrm.SaveAsDefaultGridView" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsDefaultGridView" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsDefaultGridViewToolTip" Image16by16="/_imgs/ribbon/SaveViewAsDefault_16.png" Image32by32="/_imgs/ribbon/setasdefaultview32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.CustomizePreviewPane" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Filters.CustomizePreviewPane" ToolTipDescription="$Resources:Ribbon.Tooltip.CustomizePreviewPane" Command="Mscrm.CustomizePreviewPane" Sequence="21" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.CustomizePreviewPane" Image16by16="/_imgs/ribbon/CustomPreviewPane_16.png" Image32by32="/_imgs/ribbon/CustomPreviewPane_32.png" TemplateAlias="o1" />
                <ToggleButton Id="Mscrm.HomepageGrid.account.ViewFilters" ToolTipTitle="$Resources:Ribbon.HomepageGrid.View.Data.Filters" ToolTipDescription="$Resources:Ribbon.Tooltip.Filters" Command="Mscrm.Filters" QueryCommand="Mscrm.Filters.Query" Sequence="23" LabelText="$Resources:Ribbon.HomepageGrid.View.Data.Filters" Alt="$Resources:Ribbon.HomepageGrid.View.Grid.FiltersToolTip" Image16by16="/_imgs/ribbon/filter16.png" Image32by32="/_imgs/ribbon/filter32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.SaveToCurrent" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_View_Filters_SaveToCurrent_ToolTipTitle" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveFiltersToCurrentView" Command="Mscrm.SaveToCurrentView" Sequence="27" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveToCurrent" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveToCurrentToolTip" Image16by16="/_imgs/ribbon/savefilters16.png" Image32by32="/_imgs/ribbon/savefilters32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.HomepageGrid.account.SaveAsNew" ToolTipTitle="$Resources:Ribbon.HomepageGrid.View.Grid.SaveAsNew" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveFiltersToNewView" Command="Mscrm.SaveAsNewView" Sequence="30" LabelText="$Resources:Ribbon.HomepageGrid.View.Grid.SaveAsNew" Alt="$Resources:Ribbon.HomepageGrid.View.Grid.SaveAsNewToolTip" Image16by16="/_imgs/ribbon/SaveFiltersAsNewView_16.png" Image32by32="/_imgs/ribbon/savefiltersasview32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.HomepageGrid.account.NewView" ToolTipTitle="$Resources:Ribbon.HomepageGrid.View.Grid.NewViewTooltip" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.HomepageGrid.View.Grid.NewViewTooltipDescription" Command="Mscrm.NewPersonalView" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.View.Grid.NewView" Alt="$Resources:Ribbon.HomepageGrid.View.Grid.NewView" Image16by16="/_imgs/ribbon/NewView_16.png" Image32by32="/_imgs/ribbon/NewView_32.png" TemplateAlias="o2" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.View.Refresh" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.MainTab.ViewGroup" Description="$Resources:Ribbon.HomepageGrid.MainTab.ViewGroup" Image32by32Popup="/_imgs/ribbon/Refresh_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.View.Refresh.Controls">
                <Button Id="Mscrm.HomepageGrid.account.RefreshButton" Command="Mscrm.RefreshGrid" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.View.Grid.Refresh" Alt="$Resources:Ribbon.HomepageGrid.View.Grid.Refresh" Image16by16="/_imgs/ribbon/Refresh16.png" Image32by32="/_imgs/ribbon/Refresh_32.png" TemplateAlias="o1" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_View_Grid_Refresh_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_HomepageGrid_Other_View_Grid_Refresh_ToolTipDescription" />
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.HomepageGrid.account.Chart" Command="Mscrm.HomepageGrid.account.Chart" Title="$Resources:Ribbon.HomepageGrid.View.Charts" Description="$Resources:Ribbon.HomepageGrid.View.Charts" Sequence="115">
          <Scaling Id="Mscrm.HomepageGrid.account.Chart.Scaling">
            <MaxSize Id="Mscrm.HomepageGrid.account.Chart.Layout.MaxSize" GroupId="Mscrm.HomepageGrid.account.Chart.Layout" Sequence="10" Size="LargeMedium" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Chart.Charts.MaxSize" GroupId="Mscrm.HomepageGrid.account.Chart.Charts" Sequence="20" Size="LargeMediumLarge" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Chart.Collaborate.MaxSize" GroupId="Mscrm.HomepageGrid.account.Chart.Collaborate" Sequence="30" Size="Large" />
            <Scale Id="Mscrm.HomepageGrid.account.Chart.Collaborate.Scale.1" GroupId="Mscrm.HomepageGrid.account.Chart.Collaborate" Sequence="40" Size="Medium" />
            <Scale Id="Mscrm.HomepageGrid.account.Chart.Charts.Scale.1" GroupId="Mscrm.HomepageGrid.account.Chart.Charts" Sequence="50" Size="MediumMediumLarge" />
            <Scale Id="Mscrm.HomepageGrid.account.Chart.Charts.Scale.2" GroupId="Mscrm.HomepageGrid.account.Chart.Charts" Sequence="60" Size="MediumSmallLarge" />
            <Scale Id="Mscrm.HomepageGrid.account.Chart.Charts.Scale.3" GroupId="Mscrm.HomepageGrid.account.Chart.Charts" Sequence="70" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Chart.Collaborate.Scale.2" GroupId="Mscrm.HomepageGrid.account.Chart.Collaborate" Sequence="80" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Chart.Layout.Scale.2" GroupId="Mscrm.HomepageGrid.account.Chart.Layout" Sequence="90" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.HomepageGrid.account.Chart.Groups">
            <Group Id="Mscrm.HomepageGrid.account.Chart.Layout" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.Data.Visuals" Description="$Resources:Ribbon.HomepageGrid.Data.Visuals" Image32by32Popup="/_imgs/ribbon/ChartPane_32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.HomepageGrid.account.Chart.Layout.Controls">
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Charts" Command="Mscrm.Charts.Flyout" ToolTipTitle="$Resources:Ribbon.HomepageGrid.View.Charts" ToolTipDescription="$Resources:Ribbon.Tooltip.Charts" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts" Alt="$Resources:Ribbon.HomepageGrid.View.Charts.ChartsToolTip" Image16by16="/_imgs/ribbon/ChartPane_16.png" Image32by32="/_imgs/ribbon/ChartPane_32.png" TemplateAlias="o1">
                  <Menu Id="Mscrm.HomepageGrid.account.Charts.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Charts.MenuSection0" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Charts.Controls0">
                        <ToggleButton Id="Mscrm.HomepageGrid.account.ChangeLayout.LeftRight" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayout" ToolTipDescription="$Resources:Ribbon.Tooltip.ChangeLayout" Command="Mscrm.ChartsLayout.LeftRight" QueryCommand="Mscrm.Charts.Layout.Query.LeftRight" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts.LeftRight" Alt="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayoutToolTip" />
                        <ToggleButton Id="Mscrm.HomepageGrid.account.ChangeLayout.Top" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayout" ToolTipDescription="$Resources:Ribbon.Tooltip.ChangeLayout" Command="Mscrm.ChartsLayout.Top" QueryCommand="Mscrm.Charts.Layout.Query.Top" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts.Top" Alt="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayoutToolTip" />
                        <ToggleButton Id="Mscrm.HomepageGrid.account.ChangeLayout.Off" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayout" ToolTipDescription="$Resources:Ribbon.Tooltip.ChangeLayout" Command="Mscrm.Charts.HomePage.Off" QueryCommand="Mscrm.Charts.Query.Off" Sequence="30" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts.Off" Alt="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayoutToolTip" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Chart.Charts" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.View.Charts" Description="$Resources:Ribbon.HomepageGrid.View.Charts" Image32by32Popup="/_imgs/ribbon/ChartsBarGraph_32.png" Template="Mscrm.Templates.Flexible3">
              <Controls Id="Mscrm.HomepageGrid.account.Chart.Charts.Controls">
                <Button Id="Mscrm.HomepageGrid.account.Chart.New" Command="Mscrm.VisualizationTab.NewChart" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.Management.New.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Management.New.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Management.New.ToolTipDescription" Image16by16="/_imgs/ribbon/newchart16.png" Image32by32="/_imgs/ribbon/newchart32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.Edit" Command="Mscrm.VisualizationTab.EditChart" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.Management.Edit.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Management.Edit.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Management.Edit.ToolTipDescription" Image16by16="/_imgs/ribbon/editchart16.png" Image32by32="/_imgs/ribbon/editchart32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.Expand" Command="Mscrm.VisualizationTab.ExpandChart" Sequence="32" LabelText="$Resources:Ribbon.VisualizationTab.Management.Expand.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Management.Expand.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Management.Expand.ToolTipDescription" Image16by16="/_imgs/ribbon/expandchart16.png" Image32by32="/_imgs/ribbon/expandchart32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.SaveCopy" Command="Mscrm.VisualizationTab.CopyChart" Sequence="35" LabelText="$Resources:Ribbon.VisualizationTab.Save.Copy.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Save.Copy.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Save.Copy.ToolTipDescription" Image16by16="/_imgs/ribbon/SaveChart16.png" Image32by32="/_imgs/ribbon/saveaschart32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.Import" Command="Mscrm.VisualizationTab.ImportChart" Sequence="40" LabelText="$Resources:Ribbon.VisualizationTab.ImportExport.Import.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.ImportExport.Import.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.ImportExport.Import.ToolTipDescription" Image16by16="/_imgs/ribbon/importchart16.png" Image32by32="/_imgs/ribbon/importchart32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.Export" Command="Mscrm.VisualizationTab.ExportChart" Sequence="50" LabelText="$Resources:Ribbon.VisualizationTab.ImportExport.Export.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.ImportExport.Export.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.ImportExport.Export.ToolTipDescription" Image16by16="/_imgs/ribbon/exportchart16.png" Image32by32="/_imgs/ribbon/exportchart32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.Delete" Command="Mscrm.DeleteChart" Sequence="60" LabelText="$Resources:Ribbon.VisualizationTab.Management.Delete.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Management.Delete.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Management.Delete.ToolTipDescription" Image16by16="/_imgs/ribbon/deletechart16.png" Image32by32="/_imgs/ribbon/deletechart32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.RefreshButton" Command="Mscrm.VisualizationTab.RefreshChart" Sequence="70" LabelText="$Resources:Web.Visualization.Update.Button" Alt="$Resources:Ribbon.HomepageGrid.View.Grid.Refresh" Image16by16="/_imgs/ribbon/Refresh16.png" Image32by32="/_imgs/ribbon/Refresh_32.png" TemplateAlias="o3" ToolTipTitle="$Resources:Web.Visualization.Update.Button" ToolTipDescription="$Resources:Web.Refrsh_Chart_Alt_Text" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Chart.Collaborate" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.MainTab.Collaborate" Description="$Resources:Ribbon.HomepageGrid.MainTab.Collaborate" Image32by32Popup="/_imgs/ribbon/Assign_32.png" Template="Mscrm.Templates.Flexible">
              <Controls Id="Mscrm.HomepageGrid.account.Chart.Collaborate.Controls">
                <Button Id="Mscrm.HomepageGrid.account.Chart.Assign" Command="Mscrm.VisualizationTab.AssignVisualization" Sequence="50" LabelText="$Resources:Ribbon.VisualizationTab.Actions.Assign" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Actions.Assign" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Actions.Assign.ToolTipDescription" Image16by16="/_imgs/ribbon/Assign_16.png" Image32by32="/_imgs/ribbon/Assign_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.Chart.Share" Command="Mscrm.VisualizationTab.ShareVisualization" Sequence="60" LabelText="$Resources:Ribbon.VisualizationTab.Actions.Share.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Actions.Share.Label" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Actions.Share.ToolTipDescription" Image16by16="/_imgs/ribbon/Share_16.png" Image32by32="/_imgs/ribbon/Sharing_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.HomepageGrid.account.Related" Command="Mscrm.HomepageGrid.account.Related" Title="$Resources:Ribbon.HomepageGrid.Related.TabName" Description="$Resources:Ribbon.HomepageGrid.Related.TabName" Sequence="120">
          <Scaling Id="Mscrm.HomepageGrid.account.Related.Scaling">
            <MaxSize Id="Mscrm.HomepageGrid.account.Related.Document.MaxSize" GroupId="Mscrm.HomepageGrid.account.Related.Document" Sequence="10" Size="Large" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Related.Activities.MaxSize" GroupId="Mscrm.HomepageGrid.account.Related.Activities" Sequence="20" Size="MaxSize" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Related.Relationship.MaxSize" GroupId="Mscrm.HomepageGrid.account.Related.Relationship" Sequence="21" Size="LargeMediumLargeMedium" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Related.Marketing.MaxSize" GroupId="Mscrm.HomepageGrid.account.Related.Marketing" Sequence="30" Size="LargeMedium" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Activities.Scale.1" GroupId="Mscrm.HomepageGrid.account.Related.Activities" Sequence="40" Size="Scale.1" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Activities.Scale.2" GroupId="Mscrm.HomepageGrid.account.Related.Activities" Sequence="50" Size="Scale.2" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Activities.Scale.3" GroupId="Mscrm.HomepageGrid.account.Related.Activities" Sequence="60" Size="Scale.3" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Document.Scale.1" GroupId="Mscrm.HomepageGrid.account.Related.Document" Sequence="70" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Activities.Scale.4" GroupId="Mscrm.HomepageGrid.account.Related.Activities" Sequence="80" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Relationship.Scale.1" GroupId="Mscrm.HomepageGrid.account.Related.Relationship" Sequence="85" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Related.Marketing.Scale.1" GroupId="Mscrm.HomepageGrid.account.Related.Marketing" Sequence="90" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.HomepageGrid.account.Related.Groups">
            <Group Id="Mscrm.HomepageGrid.account.Related.Document" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.Add.Document" Image32by32Popup="/_imgs/ribbon/Attachment_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.Related.Document.Controls">
                <Button Id="Mscrm.HomepageGrid.account.AddFile" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Document_AddFile_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AttachFile" Command="Mscrm.AddFileToSelectedRecord" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Add.Document.AddFile" Alt="$Resources:Ribbon.HomepageGrid.Add.Document.AddFile" Image16by16="/_imgs/ribbon/Attachment_16.png" Image32by32="/_imgs/ribbon/Attachment_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.AddNote" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Document_AddNote_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddNote" Command="Mscrm.AddNoteToSelectedRecord" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Add.Document.AddNote" Alt="$Resources:Ribbon.HomepageGrid.Add.Document.AddNote" Image16by16="/_imgs/ribbon/AddNote_16.png" Image32by32="/_imgs/ribbon/noteyellowadd32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Related.Activities" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.Add.Activities" Image32by32Popup="/_imgs/ribbon/entity32_4212.png" Template="Mscrm.Templates.Activities">
              <Controls Id="Mscrm.HomepageGrid.account.Related.Activities.Controls">
                <Button Id="Mscrm.HomepageGrid.account.AddTask" Command="Mscrm.AddTaskToSelectedRecord" Sequence="10" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddTask_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_HomepageGrid_EntityLogicalName_Related_Activities_AddTask_ToolTipDescription" LabelText="{!EntityDisplayName:task}" Alt="{!EntityDisplayName:task}" Image16by16="/_imgs/ribbon/AddTask_16.png" Image32by32="/_imgs/ribbon/entity32_4212.png" TemplateAlias="c1" />
                <Button Id="Mscrm.HomepageGrid.account.AddEmail" Command="Mscrm.SendEmailToSelectedRecord" Sequence="20" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddEmail_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddEmail" LabelText="{!EntityDisplayName:email}" Alt="{!EntityDisplayName:email}" Image16by16="/_imgs/ribbon/SendDirectMail_16.png" Image32by32="/_imgs/ribbon/Email_32.png" TemplateAlias="c2" />
                <Button Id="Mscrm.HomepageGrid.account.AddPhone" Command="Mscrm.AddPhoneToSelectedRecord" Sequence="30" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddPhone_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddPhoneCall" LabelText="{!EntityDisplayName:phonecall}" Alt="{!EntityDisplayName:phonecall}" Image16by16="/_imgs/ribbon/AddPhone_16.png" Image32by32="/_imgs/ribbon/entity32_4210.png" TemplateAlias="c3" />
                <Button Id="Mscrm.HomepageGrid.account.AddLetter" Command="Mscrm.AddLetterToSelectedRecord" Sequence="40" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddLetter_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddLetter" LabelText="{!EntityDisplayName:letter}" Alt="{!EntityDisplayName:letter}" Image16by16="/_imgs/ribbon/AddLetter_16.png" Image32by32="/_imgs/ribbon/entity32_4207.png" TemplateAlias="c4" />
                <Button Id="Mscrm.HomepageGrid.account.AddFax" Command="Mscrm.AddFaxToSelectedRecord" Sequence="50" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddFax_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddFax" LabelText="{!EntityDisplayName:fax}" Alt="{!EntityDisplayName:fax}" Image16by16="/_imgs/ribbon/AddFax_16.png" Image32by32="/_imgs/ribbon/entity32_4204.png" TemplateAlias="c5" />
                <Button Id="Mscrm.HomepageGrid.account.AddAppointment" Command="Mscrm.AddAppointmentToSelectedRecord" Sequence="60" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddAppointment_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddAppointment" LabelText="{!EntityDisplayName:appointment}" Alt="{!EntityDisplayName:appointment}" Image16by16="/_imgs/ribbon/AddAppointment_16.png" Image32by32="/_imgs/ribbon/entity32_4201.png" TemplateAlias="c6" />
                <Button Id="Mscrm.HomepageGrid.account.AddRecurringAppointment" Command="Mscrm.AddRecurringAppointmentToSelectedRecord" Sequence="70" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddRecurringAppointment_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddRecurringAppointment" LabelText="{!EntityDisplayName:recurringappointmentmaster}" Alt="{!EntityDisplayName:recurringappointmentmaster}" Image16by16="/_imgs/ribbon/RecurringAppointmentInstance_16.png" Image32by32="/_imgs/ribbon/RecurringAppointmentInstance_32.png" TemplateAlias="c7" />
                <Button Id="Mscrm.HomepageGrid.account.AddServiceActivity" Command="Mscrm.AddServiceActivityToSelectedRecord" Sequence="80" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddServiceActivity_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddServiceActivity" LabelText="{!EntityDisplayName:serviceappointment}" Alt="{!EntityDisplayName:serviceappointment}" Image16by16="/_imgs/ribbon/AddServiceActivity_16.png" Image32by32="/_imgs/ribbon/AddServiceActivity_32.png" TemplateAlias="c8" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.AddOtherActivities" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Add.Related.OtherActivities" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddOtherActivities" Command="Mscrm.Grid.AddCustomActivity" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Grid.AddActivity" Sequence="90" LabelText="$Resources:Ribbon.HomepageGrid.Add.Related.OtherActivities" Alt="$Resources:Ribbon.HomepageGrid.Add.Related.OtherActivities" Image16by16="/_imgs/ribbon/AddActivity_16.png" Image32by32="/_imgs/ribbon/AddActivity_32.png" TemplateAlias="c9" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Related.Marketing" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.account.Add.Marketing" Image32by32Popup="/_imgs/ribbon/mailmerge32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.HomepageGrid.account.Related.Marketing.Controls">
                <Button Id="Mscrm.HomepageGrid.account.MailMerge" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.MailMerge" Command="Mscrm.MailMergeSelected" Sequence="10" Alt="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" LabelText="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" Image16by16="/_imgs/ribbon/mailmerge16.png" Image32by32="/_imgs/ribbon/mailmerge32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.AddCampaignResponse" Command="Mscrm.AddCampaignResponseToSelectedRecord" Sequence="20" ToolTipTitle="$Resources:Mscrm_HomepageGrid_Other_Related_Activities_AddCampaignResponse_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddCampaignResponse" LabelText="{!EntityDisplayName:campaignresponse}" Alt="{!EntityDisplayName:campaignresponse}" Image16by16="/_imgs/ribbon/AddCampaignResponse_16.png" Image32by32="/_imgs/ribbon/entity32_4401.png" TemplateAlias="o1" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.QuickCampaign" Command="Mscrm.HomepageGrid.QuickCampaign" Sequence="40" Alt="$LocLabels:Ribbon.QuickCampaign.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.LabelText" Image16by16="/_imgs/ribbon/CreateRelatedQuickCampaign_16.png" Image32by32="/_imgs/ribbon/CreateRelatedQuickCampaign_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.LabelText" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.ToolTip.Description" TemplateAlias="o2" ModernImage="CreateQuickCampaign">
                  <Menu Id="Mscrm.HomepageGrid.account.QuickCampaign.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.QuickCampaign.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.QuickCampaign.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.QuickCampaign.Selected" Command="Mscrm.HomepageGrid.ACL.QuickCampaign.Selected" Sequence="10" Alt="$LocLabels:Ribbon.QuickCampaign.Selected.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.Selected.LabelText" Image16by16="/_imgs/ribbon/SelectedRecords_16.png" Image32by32="/_imgs/ribbon/SelectedRecords_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.Selected.ToolTip.Title" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.Selected.ToolTip.Description" ModernImage="MultiSelect" />
                        <Button Id="Mscrm.HomepageGrid.account.QuickCampaign.AllCurrentPage" Command="Mscrm.HomepageGrid.ACL.QuickCampaign.AllCurrentPage" Sequence="20" Alt="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.LabelText" Image16by16="/_imgs/ribbon/AddToMarketingList_16.png" Image32by32="/_imgs/ribbon/AddToMarketingList_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.ToolTip.Title" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.ToolTip.Description" ModernImage="Letter" />
                        <Button Id="Mscrm.HomepageGrid.account.QuickCampaign.AllAllPages" Command="Mscrm.HomepageGrid.ACL.QuickCampaign.AllAllPages" Sequence="30" Alt="$LocLabels:Ribbon.QuickCampaign.AllAllPages.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.AllAllPages.LabelText" Image16by16="/_imgs/ribbon/AllRecordsAllPages_16.png" Image32by32="/_imgs/ribbon/AllRecordsAllPages_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.AllAllPages.ToolTip.Title" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.AllAllPages.ToolTip.Description" ModernImage="BrowseCards" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Related.Relationship" Command="Mscrm.Enabled" Sequence="30" Title="$LocLabels:Ribbon.HomepageGrid.account.Relationship" Image32by32Popup="$webresource:Sales/_imgs/ribbon/Relationship_32.png" Template="Mscrm.Templates.FourOverflow">
              <Controls Id="Mscrm.HomepageGrid.account.Related.Relationship.Controls">
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.Relationship" ToolTipTitle="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.AddRelationship" Command="Mscrm.HomepageGrid.account.Relationship" Sequence="40" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship" Image16by16="$webresource:Sales/_imgs/ribbon/Relationship_16.png" Image32by32="$webresource:Sales/_imgs/ribbon/Relationship_32.png" TemplateAlias="o1">
                  <Menu Id="Mscrm.HomepageGrid.account.Relationship.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.Relationship.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.Relationship.Controls">
                        <Button Id="Mscrm.HomepageGrid.account.Relationship.Opportunity" Command="Mscrm.HomepageGrid.account.Relationship.Opportunity" Sequence="10" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship.Opportunity" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship.Opportunity" Image16by16="$webresource:Sales/_imgs/ribbon/CreateRelatedOpportunity_16.png" Image32by32="$webresource:Sales/_imgs/ribbon/CreateRelatedOpportunity_32.png" ToolTipTitle="$LocLabels:Mscrm_HomepageGrid_account_Related_Relationship_Relationship_Opportunity_ToolTipTitle" ToolTipDescription="$LocLabels:Mscrm_HomepageGrid_account_Related_Relationship_Relationship_Opportunity_ToolTipDescription" />
                        <Button Id="Mscrm.HomepageGrid.account.Relationship.Customer" Command="Mscrm.HomepageGrid.account.Relationship.Customer" Sequence="20" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship.Customer" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship.Customer" Image16by16="$webresource:Sales/_imgs/ribbon/CustomerRelationship_16.png" Image32by32="$webresource:Sales/_imgs/ribbon/CreateRelatedCustomerRelationship_32.png" ToolTipTitle="$LocLabels:Mscrm_HomepageGrid_account_Related_Relationship_Relationship_Customer_ToolTipTitle" ToolTipDescription="$LocLabels:Mscrm_HomepageGrid_account_Related_Relationship_Relationship_Customer_ToolTipDescription" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.HomepageGrid.account.Developer" Command="Mscrm.HomepageGrid.account.Developer" Title="$Resources:Ribbon.HomepageGrid.Developer.TabName" Description="$Resources:Ribbon.HomepageGrid.Developer.TabName" Sequence="130">
          <Scaling Id="Mscrm.HomepageGrid.account.Developer.Scaling">
            <MaxSize Id="Mscrm.HomepageGrid.account.Developer.Design.MaxSize" GroupId="Mscrm.HomepageGrid.account.Developer.Design" Sequence="10" Size="Large" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Developer.Create.MaxSize" GroupId="Mscrm.HomepageGrid.account.Developer.Create" Sequence="20" Size="Large" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Developer.Customize.MaxSize" GroupId="Mscrm.HomepageGrid.account.Developer.Customize" Sequence="30" Size="Large" />
            <MaxSize Id="Mscrm.HomepageGrid.account.Developer.Publish.MaxSize" GroupId="Mscrm.HomepageGrid.account.Developer.Publish" Sequence="40" Size="Large" />
            <Scale Id="Mscrm.HomepageGrid.account.Developer.Customize.Scale.1" GroupId="Mscrm.HomepageGrid.account.Developer.Customize" Sequence="50" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Developer.Create.Scale.1" GroupId="Mscrm.HomepageGrid.account.Developer.Create" Sequence="60" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Developer.Design.Scale.1" GroupId="Mscrm.HomepageGrid.account.Developer.Design" Sequence="70" Size="Popup" />
            <Scale Id="Mscrm.HomepageGrid.account.Developer.Publish.Scale.1" GroupId="Mscrm.HomepageGrid.account.Developer.Publish" Sequence="80" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.HomepageGrid.account.Developer.Groups">
            <Group Id="Mscrm.HomepageGrid.account.Developer.Design" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.Developer.Design" Description="$Resources:Ribbon.HomepageGrid.Developer.Design" Image32by32Popup="/_imgs/ribbon/DesignView_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.Developer.Design.Controls">
                <Button Id="Mscrm.HomepageGrid.account.DesignView" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Customize.DesignView" ToolTipDescription="$Resources:Ribbon.Tooltip.DesignView" Command="Mscrm.DesignView" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Customize.DesignView" Alt="$Resources:Ribbon.HomepageGrid.Data.Customize.DesignView" Image16by16="/_imgs/ribbon/DesignView_16.png" Image32by32="/_imgs/ribbon/DesignView_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Developer.Create" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.Developer.Create" Description="$Resources:Ribbon.HomepageGrid.Developer.Create" Image32by32Popup="/_imgs/ribbon/SystemViews_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.Developer.Create.Controls">
                <Button Id="Mscrm.HomepageGrid.account.SystemView" Command="Mscrm.CreateView" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Developer.Create.SystemView" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Developer.Create.SystemView" ToolTipDescription="$Resources:Ribbon.Tooltip.CreateView" Alt="$Resources:Ribbon.HomepageGrid.Developer.Create.SystemView" Image16by16="/_imgs/ribbon/SystemView_16.png" Image32by32="/_imgs/ribbon/SystemViews_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Developer.Customize" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.Developer.Customize" Description="$Resources:Ribbon.HomepageGrid.Developer.Customize" Image32by32Popup="/_imgs/ribbon/CustomEntity_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.Developer.Customize.Controls">
                <Button Id="Mscrm.HomepageGrid.account.CustomizeEntity" Command="Mscrm.CustomizeEntity" Sequence="10" ToolTipTitle="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity" ToolTipDescription="$Resources:Mscrm_HomepageGrid_Other_Developer_Customize_CustomizeEntity_ToolTipDescription" LabelText="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity" Alt="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity" Image16by16="/_imgs/ribbon/CustomEntity_16.png" Image32by32="/_imgs/ribbon/CustomEntity_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.ManageView" Command="Mscrm.ManageViews" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Developer.Customize.View" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Developer.Customize.View" ToolTipDescription="$Resources:Ribbon.Tooltip.CustomizeView" Alt="$Resources:Ribbon.HomepageGrid.Developer.Customize.View" Image16by16="/_imgs/FormEditorRibbon/Properties_16.png" Image32by32="/_imgs/FormEditorRibbon/Properties_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.SaveFiltersToCurrentSystemView" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Developer.Customize.SaveFiltersToCurrentSystemView" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveFiltersToCurrentSystemView" Command="Mscrm.SaveFilterForSystemQuery" Sequence="30" LabelText="$Resources:Ribbon.HomepageGrid.Developer.Customize.SaveFiltersToCurrentSystemView" Alt="$Resources:Ribbon.HomepageGrid.Developer.Customize.SaveFiltersToCurrentSystemView" Image16by16="/_imgs/ribbon/savefilters16.png" Image32by32="/_imgs/ribbon/savefilters32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.HomepageGrid.account.Developer.Publish" Command="Mscrm.Enabled" Sequence="40" Title="$Resources:Ribbon.Form.Developer.Customize.Publish" Description="$Resources:Ribbon.Form.Developer.Customize.Publish" Image32by32Popup="/_imgs/ribbon/PublishAll_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.HomepageGrid.account.Developer.Publish.Controls">
                <Button Id="Mscrm.HomepageGrid.account.PublishEntity" Command="Mscrm.PublishEntity" Sequence="10" ToolTipTitle="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity" ToolTipDescription="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity.TooTipDesc" LabelText="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity" Alt="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity" Image16by16="/_imgs/ribbon/PublishEntity_16.png" Image32by32="/_imgs/ribbon/PublishEntity_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.HomepageGrid.account.PublishAll" Command="Mscrm.PublishAll" Sequence="20" ToolTipTitle="$Resources:Ribbon.Form.Developer.Customize.PublishAll" ToolTipDescription="$Resources:Ribbon.Form.Developer.Customize.PublishAll.TooTipDesc" LabelText="$Resources:Ribbon.Form.Developer.Customize.PublishAll" Alt="$Resources:Ribbon.Form.Developer.Customize.PublishAll" Image16by16="/_imgs/ribbon/PublishAll_16.png" Image32by32="/_imgs/ribbon/PublishAll_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.Form.account.MainTab" Command="Mscrm.Form.account.MainTab" Title="Account" Description="Account" Sequence="10">
          <Scaling Id="Mscrm.Form.account.MainTab.Scaling">
            <MaxSize Id="Mscrm.Form.account.MainTab.Save.MaxSize" GroupId="Mscrm.Form.account.MainTab.Save" Sequence="10" Size="LargeMedium" />
            <MaxSize Id="FieldService.Form.account.MainTab.LocationGroup.MaxSize" GroupId="FieldService.Form.account.MainTab.LocationGroup" Sequence="10" Size="LargeMedium" />
            <MaxSize Id="Mscrm.Form.account.MainTab.Collaborate.MaxSize" GroupId="Mscrm.Form.account.MainTab.Collaborate" Sequence="20" Size="LargeMedium" />
            <MaxSize Id="Mscrm.Form.account.MainTab.Management.MaxSize" GroupId="Mscrm.Form.account.MainTab.Management" Sequence="30" Size="LargeLarge" />
            <MaxSize Id="Mscrm.Form.account.MainTab.Actions.MaxSize" GroupId="Mscrm.Form.account.MainTab.Actions" Sequence="40" Size="LargeMediumLarge" />
            <MaxSize Id="Mscrm.Form.account.MainTab.Convert.MaxSize" GroupId="Mscrm.Form.account.MainTab.Convert" Sequence="41" Size="LargeMedium" />
            <MaxSize Id="Mscrm.Form.account.MainTab.ExportData.MaxSize" GroupId="Mscrm.Form.account.MainTab.ExportData" Sequence="50" Size="LargeMedium" />
            <MaxSize Id="Mscrm.Form.account.MainTab.Workflow.MaxSize" GroupId="Mscrm.Form.account.MainTab.Workflow" Sequence="60" Size="Large" />
            <MaxSize Id="Mscrm.Form.account.MainTab.Find.MaxSize" GroupId="Mscrm.Form.account.MainTab.Find" Sequence="70" Size="Large" />
            <Scale Id="Mscrm.Form.account.MainTab.ExportData.Scale.1" GroupId="Mscrm.Form.account.MainTab.ExportData" Sequence="90" Size="LargeSmall" />
            <Scale Id="Mscrm.Form.account.MainTab.ConvertGroup.Scale.1" GroupId="Mscrm.Form.account.MainTab.Convert" Sequence="99" Size="LargeSmall" />
            <Scale Id="Mscrm.Form.account.MainTab.Workflow.Scale.2" GroupId="Mscrm.Form.account.MainTab.Workflow" Sequence="100" Size="Popup" />
            <Scale Id="Mscrm.Form.account.MainTab.Collaborate.Scale.1" GroupId="Mscrm.Form.account.MainTab.Collaborate" Sequence="110" Size="LargeSmall" />
            <Scale Id="Mscrm.Form.account.MainTab.ConvertGroup.Scale.2" GroupId="Mscrm.Form.account.MainTab.Convert" Sequence="113" Size="Popup" />
            <Scale Id="Mscrm.Form.account.MainTab.Save.Scale.1" GroupId="Mscrm.Form.account.MainTab.Save" Sequence="130" Size="LargeSmall" />
            <Scale Id="Mscrm.Form.account.MainTab.ExportData.Scale.2" GroupId="Mscrm.Form.account.MainTab.ExportData" Sequence="140" Size="Popup" />
            <Scale Id="Mscrm.Form.account.MainTab.Management.Scale.4" GroupId="Mscrm.Form.account.MainTab.Management" Sequence="150" Size="Popup" />
            <Scale Id="Mscrm.Form.account.MainTab.Collaborate.Scale.2" GroupId="Mscrm.Form.account.MainTab.Collaborate" Sequence="160" Size="Popup" />
            <Scale Id="Mscrm.Form.account.MainTab.Save.Scale.2" GroupId="Mscrm.Form.account.MainTab.Save" Sequence="170" Size="Popup" />
            <Scale Id="Mscrm.Form.account.MainTab.Actions.Scale.1" GroupId="Mscrm.Form.account.MainTab.Actions" Sequence="180" Size="Popup" />
            <Scale Id="FieldService.Form.account.MainTab.LocationGroup.Scale.Popup" GroupId="FieldService.Form.account.MainTab.LocationGroup" Sequence="300" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.Form.account.MainTab.Groups">
            <Group Id="Mscrm.Form.account.MainTab.Save" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.Form.MainTab.Save" Image32by32Popup="/_imgs/ribbon/Save_32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.Form.account.MainTab.Save.Controls">
                <Button Id="MailApp.Form.SetRegarding.account.Button" Command="MailApp.Form.SetRegardingCommand" Sequence="1" LabelText="$LocLabels:MailApp.Form.SetRegarding.Button.Label" ToolTipTitle="$LocLabels:MailApp.Form.SetRegarding.Button.ToolTip" TemplateAlias="o1" ModernImage="LinkArticle" />
                <Button Id="Mscrm.Form.account.Save" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_Save_Save_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Save" Command="Mscrm.SavePrimary" Sequence="10" LabelText="$Resources:Ribbon.Form.MainTab.Save.Save" Alt="$Resources:Ribbon.Form.MainTab.Save.Save" Image16by16="/_imgs/ribbon/Save_16.png" Image32by32="/_imgs/ribbon/Save_32.png" TemplateAlias="o1" ModernImage="Save" />
                <Button Id="MailApp.Form.OpenRecordOnWeb.account.Button" Command="MailApp.Form.OpenRecordOnWebCommand" Sequence="10" LabelText="$LocLabels:MailApp.OpenRecordOnWeb.Button.Label" ToolTipTitle="$LocLabels:MailApp.OpenRecordOnWeb.Button.Label" TemplateAlias="o1" ModernImage="Dynamics365" />
                <Button Id="Mscrm.Form.account.SaveAsComplete" ToolTipTitle="$Resources:Ribbon.Form.MainTab.Save.SaveAsComplete" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.SaveAsComplete" Command="Mscrm.SavePrimaryActivityAsComplete" Sequence="20" LabelText="$Resources:Ribbon.Form.MainTab.Save.SaveAsComplete" Alt="$Resources:Ribbon.Form.MainTab.Save.SaveAsComplete" Image16by16="/_imgs/ribbon/MarkAsComplete_16.png" Image32by32="/_imgs/ribbon/SaveAsCompleted_32.png" TemplateAlias="o1" ModernImage="SaveAsComplete" />
                <Button Id="Mscrm.Form.account.SaveAndClose" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_Save_SaveAndClose_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.SaveAndClose" Command="Mscrm.SaveAndClosePrimary" Sequence="30" LabelText="$Resources:Ribbon.Form.MainTab.Save.SaveAndClose" Alt="$Resources:Ribbon.Form.MainTab.Save.SaveAndClose" Image16by16="/_imgs/FormEditorRibbon/SaveAndClose_16.png" Image32by32="/_imgs/ribbon/SaveAndClose_32.png" TemplateAlias="o1" ModernImage="SaveAndClose" />
                <Button Id="Mscrm.Form.account.SaveAndNew" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_Save_SaveAndNew_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.SaveAndNew" Command="Mscrm.SaveAndNewPrimary" Sequence="40" LabelText="$Resources:Ribbon.Form.MainTab.Save.SaveAndNew" Alt="$Resources:Ribbon.Form.MainTab.Save.SaveAndNew" Image16by16="/_imgs/ribbon/saveandnew16.png" Image32by32="/_imgs/ribbon/saveandnew32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.Form.account.NewRecord" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.New" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.New" Command="Mscrm.NewRecordFromForm" Sequence="45" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.New" Alt="$Resources:Ribbon.HomepageGrid.MainTab.New" Image16by16="/_imgs/ribbon/NewRecord_16.png" Image32by32="/_imgs/ribbon/newrecord32.png" TemplateAlias="o1" ModernImage="New" />
                <Button Id="Mscrm.Form.account.NewRecordForBPFEntity" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.New" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.New" Command="Mscrm.Form.NewRecordForBPFEntity" Sequence="45" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.New" Alt="$Resources:Ribbon.HomepageGrid.MainTab.New" Image16by16="/_imgs/ribbon/NewRecord_16.png" Image32by32="/_imgs/ribbon/newrecord32.png" TemplateAlias="o1" ModernImage="New" />
                <Button Id="Mscrm.Form.account.Activate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Activate" Command="Mscrm.Form.Activate" Sequence="50" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" Image16by16="/_imgs/ribbon/Activate_16.png" Image32by32="/_imgs/ribbon/Activate_32.png" TemplateAlias="o2" ModernImage="Activate" />
                <Button Id="Mscrm.Form.account.ViewOrgChart" Command="LinkedInExtensions.ViewOrgChart" Sequence="52" Alt="$LocLabels:Mscrm.Form.account.ViewOrgChart" LabelText="$LocLabels:Mscrm.Form.account.ViewOrgChart" ToolTipTitle="$LocLabels:Mscrm.Form.account.ViewOrgChart.ToolTipTitle" ToolTipDescription="$LocLabels:Mscrm.Form.account.ViewOrgChart.ToolTipDesc" ModernImage="Drilldown" />
                <Button Alt="$LocLabels:Ribbon.HomepageGrid.queueitem.MainTab.Actions.QueueItemDetail" Command="Mscrm.QueueItemDetailOmnichannel" Id="Mscrm.Form.account.QueueItemDetailOmnichannel" Image32by32="$webresource:Service/_imgs/Workplace/QueueItemDetails_32.png" Image16by16="$webresource:Service/_imgs/Workplace/QueueItemDetails_16.png" LabelText="$LocLabels:Ribbon.HomepageGrid.queueitem.MainTab.Actions.QueueItemDetail" Sequence="53" TemplateAlias="o1" ToolTipTitle="$LocLabels:Ribbon.HomepageGrid.queueitem.MainTab.Actions.QueueItemDetail" ToolTipDescription="$LocLabels:Mscrm_SubGrid_queueitem_MainTab_Actions_QueueItemDetail_ToolTipDescription" ModernImage="QueueItemDetail" />
                <Button Id="Mscrm.Form.account.Deactivate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Deactivate" Command="Mscrm.Form.Deactivate" Sequence="60" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" Image16by16="/_imgs/ribbon/Deactivate_16.png" Image32by32="/_imgs/ribbon/Deactivate_32.png" TemplateAlias="o2" ModernImage="DeActivate" />
                <SplitButton Id="Mscrm.Form.account.AddConnection" ToolTipTitle="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" ToolTipDescription="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Tooltip" Command="Mscrm.AddConnectionForm" Sequence="61" LabelText="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" Alt="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" Image16by16="/_imgs/ribbon/AddConnection_16.png" Image32by32="/_imgs/ribbon/AddConnection_32.png" TemplateAlias="o1" ModernImage="Connect">
                  <Menu Id="Mscrm.Form.account.AddConnection.Menu">
                    <MenuSection Id="Mscrm.Form.account.AddConnection.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.Form.account.AddConnection.Controls">
                        <Button Id="Mscrm.Form.account.AddConnectionNew" ToolTipTitle="$Resources:Ribbon.Connection.AddConnectionNew.Label" ToolTipDescription="$Resources:Ribbon.Connection.AddConnectionNew.Tooltip" Command="Mscrm.AddConnectionForm" Sequence="40" LabelText="$Resources:Ribbon.Connection.AddConnectionNew.Label" Alt="$Resources:Ribbon.Connection.AddConnectionNew.Label" ModernImage="ConnectionToOther" />
                        <Button Id="Mscrm.Form.account.AddConnectionToMe" ToolTipTitle="$Resources:Ribbon.Connection.AddConnectionToMe.Label" ToolTipDescription="$Resources:Ribbon.Connection.AddConnectionToMe.Tooltip" Command="Mscrm.AddConnectionToMeForm" Sequence="41" LabelText="$Resources:Ribbon.Connection.AddConnectionToMe.Label" Alt="$Resources:Ribbon.Connection.AddConnectionToMe.Label" ModernImage="ConnectionToMe" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </SplitButton>
                <Button Id="Mscrm.Form.account.AddToList" Command="Mscrm.AddPrimaryToMarketingList" ToolTipTitle="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.AddToMarketingList" Sequence="62" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" Image16by16="$webresource:Marketing/_images/ribbon/AddToMarketingList_16.png" Image32by32="$webresource:Marketing/_images/ribbon/AddToMarketingList_32.png" TemplateAlias="o1" ModernImage="BulletListAdd" />
                <Button Id="Mscrm.Form.account.Assign" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Assign" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Assign" Command="Mscrm.AssignPrimaryRecord" Sequence="63" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Assign" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Assign" Image16by16="/_imgs/ribbon/Assign_16.png" Image32by32="/_imgs/ribbon/Assign_32.png" TemplateAlias="o1" ModernImage="Assign" />
                <Button Id="Mscrm.Form.account.SendSelected" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" ToolTipDescription="$Resources:Ribbon.Tooltip.SendShortcut" Command="Mscrm.SendShortcutPrimary" Sequence="64" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" Alt="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" Image16by16="/_imgs/ribbon/SendShortcut_16.png" Image32by32="/_imgs/ribbon/SendShortcut_32.png" TemplateAlias="o2" ModernImage="EmailLink" />
                <Button Alt="$LocLabels:msdyn.ApplicationRibbon.Form.BookResource.Button.Alt" Command="msdyn.ApplicationRibbon.Form.BookResource.Command" Description="Book" Id="msdyn.ApplicationRibbon.account.Form.BookResource.Button" ModernImage="$webresource:msdyn_/fps/Icons/CommandBar/CalendarButton.svg" LabelText="$LocLabels:msdyn.ApplicationRibbon.Form.BookResource.Button.LabelText" Sequence="65" TemplateAlias="o2" ToolTipTitle="$LocLabels:msdyn.ApplicationRibbon.Form.BookResource.Button.ToolTipTitle" ToolTipDescription="$LocLabels:msdyn.ApplicationRibbon.Form.BookResource.Button.ToolTipDescription" />
                <Button Alt="$LocLabels:msdyn.ApplicationRibbon.Form.SaveAndRunRoutingRule.Button.Alt" Command="msdyn.ApplicationRibbon.Form.SaveAndRunRoutingRule.Command" Description="Save &amp; Route" Id="msdyn.ApplicationRibbon.account.Form.SaveAndRunRoutingRule.Button" LabelText="$LocLabels:msdyn.ApplicationRibbon.Form.SaveAndRunRoutingRule.Button.LabelText" Sequence="65" TemplateAlias="o2" Image16by16="$webresource:msdyn_/AnyEntityRoutingRule/_imgs/16_save_route.png" Image32by32="$webresource:msdyn_/AnyEntityRoutingRule/_imgs/32_save_route.png" ToolTipTitle="$LocLabels:msdyn.ApplicationRibbon.Form.SaveAndRunRoutingRule.Button.ToolTipTitle" ToolTipDescription="$LocLabels:msdyn.ApplicationRibbon.Form.SaveAndRunRoutingRule.Button.ToolTipDescription" ModernImage="SaveAndRunRoutingRule" />
                <Button Id="Mscrm.Form.account.Delete" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_Management_Delete_ToolTipTitle" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Delete" Command="Mscrm.DeletePrimaryRecord" Sequence="65" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Image16by16="/_imgs/ribbon/delete16.png" Image32by32="/_imgs/Workplace/remove_32.png" TemplateAlias="o2" ModernImage="Remove" />
                <Button Id="Mscrm.Form.account.FormDesign" ToolTipTitle="$Resources:Ribbon.Form.Data.Customize.FormDesign" ToolTipDescription="$Resources:Ribbon.Tooltip.DesignForm" Command="Mscrm.FormDesign.OpenFromForm" Sequence="69" LabelText="$Resources:Ribbon.Form.Data.Customize.FormDesign" Alt="$Resources:Ribbon.Form.Data.Customize.FormDesign" Image16by16="/_imgs/ribbon/formdesign16.png" Image32by32="/_imgs/ribbon/EditForm_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.Form.account.OpenActiveStage" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_OpenActiveStage_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Form.Tooltip.OpenActiveStage" Command="Mscrm.Form.OpenActiveStage" Sequence="80" LabelText="$Resources:Ribbon.Form.MainTab.OpenActiveStage" Alt="$Resources:Ribbon.Form.MainTab.OpenActiveStage" Image16by16="/_imgs/ribbon/formdesign16.png" Image32by32="/_imgs/ribbon/EditForm_32.png" TemplateAlias="o2" ModernImage="FormDesign" />
                <Button Alt="$LocLabels:GuidedHelp.Alt" Command="loadGuidedHelp" Description="Learning Path" Id="GuidedHelp.account.Form" LabelText="$LocLabels:GuidedHelp.LabelText" Sequence="80" TemplateAlias="o2" ToolTipTitle="$LocLabels:GuidedHelp.ToolTipTitle" ToolTipDescription="$LocLabels:GuidedHelp.ToolTipDescription" />
                <Button Alt="$LocLabels:LPLibrary.Alt" Command="launchLPLibrary" Description="Learning Path Library" Id="LPLibrary.account.Form" LabelText="$LocLabels:LPLibrary.LabelText" Sequence="90" TemplateAlias="o2" ToolTipTitle="$LocLabels:LPLibrary.ToolTipTitle" ToolTipDescription="$LocLabels:LPLibrary.ToolTipDescription" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.ModernClient" Command="Mscrm.Enabled" Sequence="11" Template="Mscrm.Templates.Flexible">
              <Controls Id="Mscrm.Form.account.MainTab.ModernClient.Controls">
                <Button Id="Mscrm.Form.account.RefreshModernButton" ToolTipTitle="$Resources:MobileClient.Commands.Refresh" Command="Mscrm.Modern.refreshCommand" ModernCommandType="ControlCommand" Sequence="17" LabelText="$Resources:MobileClient.Commands.Refresh" ModernImage="Refresh" TemplateAlias="o1" />
                <Button Id="AccessChecker.OpenDialog.account.Button" Command="AccessChecker.OpenDialogCommand" Sequence="17" LabelText="$LocLabels:AccessChecker.OpenDialog.Button.Label" ToolTipTitle="$LocLabels:AccessChecker.OpenDialog.Button.Label" TemplateAlias="o1" ModernImage="$webresource:accessChecker_icon" />
                <Button Id="Mscrm.Form.account.FollowButtonForYammer" Command="Mscrm.Form.YammerCommand" ToolTipTitle="$LocLabels:YammerIntegration.Yammer" ToolTipDescription="$LocLabels:YammerIntegration.Yammer" LabelText="$LocLabels:YammerIntegration.Yammer" Alt="$LocLabels:YammerIntegration.Yammer" TemplateAlias="o2" Sequence="1010" ModernImage="YammerIcon" />
                <Button Id="Mscrm.Form.account.PDFButtonId" Command="Mscrm.Form.PDFCommand" ToolTipTitle="$LocLabels:AppCommon.PDFToolTip" ToolTipDescription="$LocLabels:AppCommon.PDFToolTip" LabelText="$LocLabels:AppCommon.PDF" Alt="$LocLabels:AppCommon.PDF" ModernImage="PdfIconFile" />
                <Button Id="Mscrm.Form.account.ActionButtonForMSTeams" Command="Mscrm.Form.MSTeamsCollaborateCommand" ToolTipTitle="$LocLabels:OfficeProductivity.MSTeamsToolTip" ToolTipDescription="$LocLabels:OfficeProductivity.MSTeamsToolTip" LabelText="$LocLabels:OfficeProductivity.MSTeams" Alt="$LocLabels:OfficeProductivity.MSTeams" TemplateAlias="o2" Sequence="1028" ModernImage="MSTeamsIcon" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.Management" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.MainTab.Management" Image32by32Popup="/_imgs/ribbon/newrecord32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.Form.account.MainTab.Management.Controls" />
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.Actions" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.MainTab.Actions" Image32by32Popup="/_imgs/ribbon/Actions_32.png" Template="Mscrm.Templates.Flexible3">
              <Controls Id="Mscrm.Form.account.MainTab.Actions.Controls">
                <FlyoutAnchor Id="Mscrm.Form.account.CreatePDF" ToolTipTitle="$LocLabels:Ribbon.Form.MainTab.Actions.CreatePDF" ToolTipDescription="$LocLabels(EntityDisplayName):Mscrm_Form_account_MainTab_Actions_CreatePDF_ToolTipDescription" Command="Mscrm.Form.account.CreatePDF" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.Form.CreatePDF.Populate.Flyout" Sequence="7" LabelText="$LocLabels:Ribbon.Form.MainTab.Actions.CreatePDF" Alt="$LocLabels:Ribbon.Form.MainTab.Actions.CreatePDF" Image16by16="/_imgs/ribbon/SystemDocumentTemplates.png" Image32by32="/_imgs/ribbon/SystemDocumentTemplates.png" TemplateAlias="o1" ModernImage="PdfIconFile" />
                <FlyoutAnchor Id="Mscrm.Form.account.EmailAsPDF" ToolTipTitle="$LocLabels:Ribbon.Form.MainTab.Actions.EmailAsPDF" ToolTipDescription="$LocLabels(EntityDisplayName):Mscrm_Form_account_MainTab_Actions_EmailAsPDF_ToolTipDescription" Command="Mscrm.Form.account.EmailAsPDF" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.Form.EmailAsPDF.Populate.Flyout" Sequence="7" LabelText="$LocLabels:Ribbon.Form.MainTab.Actions.EmailAsPDF" Alt="$LocLabels:Ribbon.Form.MainTab.Actions.EmailAsPDF" Image16by16="/_imgs/ribbon/SystemDocumentTemplates.png" Image32by32="/_imgs/ribbon/SystemDocumentTemplates.png" TemplateAlias="o1" ModernImage="SendByEmail" />
                <Button Id="Mscrm.Form.account.Close" ToolTipTitle="$Resources(EntityDisplayName):Ribbon.HomepageGrid.MainTab.Actions.Close" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_Form_EntityLogicalName_MainTab_Actions_Close_ToolTipDescription" Command="Mscrm.Form.CloseActivity" Sequence="9" LabelText="$Resources(EntityDisplayName):Ribbon.HomepageGrid.MainTab.Actions.Close" Alt="$Resources(EntityDisplayName):Ribbon.HomepageGrid.MainTab.Actions.Close" Image16by16="/_imgs/ribbon/Close_16.png" Image32by32="/_imgs/ribbon/ActivtiyClose_32.png" TemplateAlias="o1" ModernImage="Close" />
                <Button Sequence="10" Id="msdyn.Form.account.ApplyCadence.Button" TemplateAlias="o1" ModernImage="Convert" LabelText="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" Alt="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" Command="Mscrm.Form.Cadence.Apply" ToolTipTitle="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" ToolTipDescription="$LocLabels:Ribbon.Form.ApplyCadence.Button.LabelText" />
                <Button Sequence="10" Id="msdyn.Form.account.DisconnectSequence.Button" TemplateAlias="o1" ModernImage="Cancel" LabelText="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" Alt="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" Command="Mscrm.Form.Sequence.Disconnect" ToolTipTitle="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" ToolTipDescription="$LocLabels:Ribbon.Sequence.Disconnect.Button.LabelText" />
                <Button Sequence="12" Id="msdyn.Form.account.LaunchPlaybook.Button" TemplateAlias="o1" ModernImage="$webresource:Playbook/msdyn_/Images/SVG/PlaybookInstanceIcon.svg" LabelText="$LocLabels:Ribbon.Form.LaunchPlaybook.Button.LabelText" Alt="$LocLabels:Ribbon.Form.LaunchPlaybook.Button.LabelText" Command="Playbook.Form.Launch" ToolTipTitle="$LocLabels:Ribbon.Form.LaunchPlaybook.Button.LabelText" ToolTipDescription="$LocLabels:Ribbon.ToolTip.LaunchPlabyook" />
                <FlyoutAnchor Id="Mscrm.HomepageGrid.account.MBPF.ConvertTo" ToolTipTitle="$Resources:RefreshCommandBar.Process" ToolTipDescription="$Resources:Ribbon.Tooltip.Process" Command="Mscrm.Form.Process" Sequence="62" LabelText="$Resources:RefreshCommandBar.Process" Alt="$Resources:RefreshCommandBar.Process" Image16by16="/_imgs/Workplace/ConvertActivity_16.png" Image32by32="/_imgs/Workplace/ConvertActivity_32.png" TemplateAlias="o1" ModernImage="Process">
                  <Menu Id="Mscrm.HomepageGrid.account.MBPF.Menu">
                    <MenuSection Id="Mscrm.HomepageGrid.account.MBPF.MenuSection" Sequence="63" DisplayMode="Menu16">
                      <Controls Id="Mscrm.HomepageGrid.account.MBPF.Controls">
                        <Button Id="Mscrm.Form.account.SwitchProcess" ToolTipTitle="$Resources:RefreshCommandBar.SwitchProcess" ToolTipDescription="$Resources:Ribbon.Tooltip.SwitchProcess" Command="Mscrm.SwitchProcess" Sequence="10" LabelText="$Resources:RefreshCommandBar.SwitchProcess" Alt="$Resources:RefreshCommandBar.SwitchProcess" Image16by16="/_imgs/ribbon/convert_16.png" Image32by32="/_imgs/ribbon/convert_32.png" TemplateAlias="o1" ModernImage="SwitchProcess" />
                        <Button Id="Mscrm.Form.account.EditSalesProcess" ToolTipTitle="$Resources:RefreshCommandBar.EditSalesProcess" ToolTipDescription="$Resources:Ribbon.Tooltip.EditSalesProcess" Command="Mscrm.EditSalesProcess" Sequence="20" LabelText="$Resources:RefreshCommandBar.EditSalesProcess" Alt="$Resources:RefreshCommandBar.EditSalesProcess" Image16by16="/_imgs/ribbon/edit_16.png" Image32by32="/_imgs/ribbon/edit32.png" TemplateAlias="o1" />
                        <Button Id="Mscrm.Form.account.Abandon" ToolTipTitle="$Resources:RefreshCommandBar.Abandon" ToolTipDescription="$Resources:Ribbon.Tooltip.Abandon" Command="Mscrm.Abandon" Sequence="30" LabelText="$Resources:RefreshCommandBar.Abandon" Alt="$Resources:RefreshCommandBar.Abandon" Image16by16="/_imgs/ribbon/convert_16.png" Image32by32="/_imgs/ribbon/convert_32.png" TemplateAlias="o1" ModernImage="Abandon" />
                        <Button Id="Mscrm.Form.account.Reactivate" ToolTipTitle="$Resources:RefreshCommandBar.Reactivate" ToolTipDescription="$Resources:Ribbon.Tooltip.Reactivate" Command="Mscrm.Reactivate" Sequence="40" LabelText="$Resources:RefreshCommandBar.Reactivate" Alt="$Resources:RefreshCommandBar.Reactivate" Image16by16="/_imgs/ribbon/convert_16.png" Image32by32="/_imgs/ribbon/convert_32.png" TemplateAlias="o1" ModernImage="Reactivate" />
                        <Button Id="Mscrm.Form.account.FinishStage" ToolTipTitle="$Resources:RefreshCommandBar.FinishStage" ToolTipDescription="$Resources:Ribbon.Tooltip.FinishStage" Command="Mscrm.FinishStage" Sequence="50" LabelText="$Resources:RefreshCommandBar.FinishStage" Alt="$Resources:RefreshCommandBar.FinishStage" Image16by16="/_imgs/ribbon/convert_16.png" Image32by32="/_imgs/ribbon/convert_32.png" TemplateAlias="o1" ModernImage="FinishStage" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
                <FlyoutAnchor Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.10.1" Alt="$LocLabels:Ribbon.Form.MainTab.Actions.EmailAsPDF" LabelText="$LocLabels(EntityDisplayName):Ribbon.Form.MainTab.Actions.EmailAsPDF" ToolTipTitle="$LocLabels:Ribbon.Form.MainTab.Actions.EmailAsPDF" ToolTipDescription="$LocLabels(EntityDisplayName):Mscrm_Form_account_MainTab_Actions_EmailAsPDF_ToolTipDescription" Command="Mscrm.Form.account.EmailAsPDF.Hide" PopulateDynamically="false" TemplateAlias="o1">
                  <Menu Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.10.2">
                    <MenuSection Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.10.3">
                      <Controls Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.10.4">
                        <Button Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.10.5" Command="Mscrm.Form.EmailAsPDF.GeneratePDFAndSendEmail" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
                <FlyoutAnchor Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.9.1" Alt="$LocLabels:Ribbon.Form.MainTab.Actions.CreatePDF" LabelText="$LocLabels:Ribbon.Form.MainTab.Actions.CreatePDF" ToolTipTitle="$LocLabels:Ribbon.Form.MainTab.Actions.CreatePDF" ToolTipDescription="$LocLabels(EntityDisplayName):Mscrm_Form_account_MainTab_Actions_CreatePDF_ToolTipDescription" Command="Mscrm.Form.account.CreatePDF.Hide" PopulateDynamically="false" TemplateAlias="o1">
                  <Menu Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.9.2">
                    <MenuSection Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.9.3">
                      <Controls Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.9.4">
                        <Button Id="Mscrm.Form.account.MainTab.Actions.Controls.CustomAction.Hidden.9.5" Command="Mscrm.Form.CreatePDF.GeneratePDF" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.Analytics" Command="Mscrm.Enabled" Sequence="31" Title="Analytics" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.Form.account.MainTab.Analytics.Controls">
                <Button Id="Mscrm.Form.account.SuggestProduct" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.SuggestProduct" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.SuggestProduct" Command="Mscrm.SuggestProduct" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.SuggestProduct" Alt="$Resources:Ribbon.HomepageGrid.MainTab.SuggestProduct" Image16by16="/_imgs/ribbon/SuggestProduct_16.png" Image32by32="/_imgs/ribbon/SuggestProduct_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.Convert" Command="Mscrm.Enabled" Sequence="32" Title="$Resources:MenuItem_Label_Convert_Entity_Mask" Description="$Resources(EntityDisplayName):MenuItem_ToolTip_Convert_Entity_Mask" Image32by32Popup="/_imgs/ribbon/ConvertOpportunity_32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.Form.account.MainTab.Convert.Controls">
                <Button Id="Mscrm.Form.account.Convert.Opportunity" Command="Mscrm.Form.ConvertToOpportunity" Sequence="10" Alt="$Resources:MenuItem_ToolTip_ConvertToOpportunity" LabelText="$Resources:MenuItem_Label_ConvertToOpportunity" Image16by16="/_imgs/ribbon/ConvertOpportunity_16.png" Image32by32="/_imgs/ribbon/ConvertOpportunity_32.png" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_Actions_Convert_Opportunity_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_Form_Other_MainTab_Actions_Convert_Opportunity_ToolTipDescription" TemplateAlias="o1" ModernImage="Opportunity" />
                <Button Id="Mscrm.Form.account.Convert.Case" Command="Mscrm.Form.ConvertToCase" Sequence="20" Alt="$Resources:MenuItem_ToolTip_ConvertToCase" LabelText="$Resources:MenuItem_Label_ConvertToCase" Image16by16="/_imgs/ribbon/ConvertCase_16.png" Image32by32="/_imgs/ribbon/ConvertCase_32.png" ToolTipTitle="$Resources:Mscrm_Form_Other_MainTab_Actions_Convert_Case_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_Form_Other_MainTab_Actions_Convert_Case_ToolTipDescription" TemplateAlias="o2" ModernImage="Case" />
                <Button Id="Mscrm.Form.account.PromoteToResponse" ToolTipTitle="$Resources:MenuItem_Label_PromoteToResponse" ToolTipDescription="$Resources:MenuItem_Tooltip_Description_PromoteToResponse" Command="Mscrm.PromoteToResponse" Sequence="30" LabelText="$Resources:MenuItem_Label_PromoteToResponse" Alt="$Resources:MenuItem_Label_PromoteToResponse" Image16by16="/_imgs/Workplace/ConvertActivity_16.png" Image32by32="/_imgs/Workplace/ConvertActivity_32.png" TemplateAlias="o2" />
              </Controls>
            </Group>
            <Group Id="FieldService.Form.account.MainTab.LocationGroup" Command="Mscrm.Enabled" Template="Mscrm.Templates.Flexible2" Sequence="35" Title="$LocLabels:FieldService.Form.account.MainTab.LocationGroup.TitleText" Description="$LocLabels:FieldService.Form.account.MainTab.LocationGroup.DescriptionText">
              <Controls Id="FieldService.Form.account.MainTab.LocationGroup.Controls">
                <Button Id="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode" Command="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Command" Sequence="20" ToolTipTitle="$LocLabels:FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.LabelText" LabelText="$LocLabels:FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.LabelText" ToolTipDescription="$LocLabels:FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Description" TemplateAlias="o1" ModernImage="$webresource:msdyn_/Icons/CommandBar/GeoCode.svg" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.Collaborate" Command="Mscrm.Enabled" Sequence="40" Title="$Resources:Ribbon.HomepageGrid.MainTab.Collaborate" Image32by32Popup="/_imgs/ribbon/Assign_32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.Form.account.MainTab.Collaborate.Controls">
                <Button Id="Mscrm.Form.account.AddToQueue" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" ToolTipDescription="$Resources(EntityPluralDisplayName):Mscrm_Form_EntityLogicalName_MainTab_Actions_AddToQueue_ToolTipDescription" Command="Mscrm.AddPrimaryToQueue" Sequence="31" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" Image16by16="/_imgs/ribbon/AddToQueue_16.png" Image32by32="/_imgs/ribbon/AddToQueue_32.png" TemplateAlias="o1" ModernImage="AddToQueue" />
                <Button Id="Mscrm.Form.account.QueueItemDetail" ToolTipTitle="$Resources:Ribbon.HomepageGrid.queueitem.MainTab.Actions.QueueItemDetail" ToolTipDescription="$Resources:Mscrm_SubGrid_queueitem_MainTab_Actions_QueueItemDetail_ToolTipDescription" Command="Mscrm.QueueItemDetail" Sequence="32" Alt="$Resources:Ribbon.HomepageGrid.queueitem.MainTab.Actions.QueueItemDetail" LabelText="$Resources:Ribbon.HomepageGrid.queueitem.MainTab.Actions.QueueItemDetail" Image16by16="/_imgs/Workplace/QueueItemDetails_16.png" Image32by32="/_imgs/Workplace/QueueItemDetails_32.png" TemplateAlias="o1" ModernImage="QueueItemDetail" />
                <Button Id="Mscrm.Form.account.ViewHierarchy" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.ViewHierarchy" ToolTipDescription="$Resources:Mscrm_MainTab_Actions_ViewHierarchy_ToolTipDescription" Command="Mscrm.ViewHierarchyForPrimaryRecord" Sequence="35" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.ViewHierarchy" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.ViewHierarchy" Image16by16="/_imgs/Hierarchy.png" Image32by32="/_imgs/ribbon/Hierarchy_32.png" TemplateAlias="o1" ModernImage="ViewHierarchy" />
                <FlyoutAnchor Id="Mscrm.Form.account.Permissions" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Permissions" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Permissions" Command="Mscrm.ShareRecordsAndSecuredFieldsPrimaryRecord" Sequence="40" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Permissions" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Permissions" Image16by16="/_imgs/ribbon/Share_16.png" Image32by32="/_imgs/ribbon/Sharing_32.png" TemplateAlias="o2">
                  <Menu Id="Mscrm.Form.account.Permissions.Menu">
                    <MenuSection Id="Mscrm.Form.account.Permissions.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.Form.account.Permissions.Controls">
                        <Button Id="Mscrm.Form.account.Permissions.SharingNonRefresh" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Share" Command="Mscrm.SharePrimaryRecord" Sequence="10" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" Image16by16="/_imgs/ribbon/Share_16.png" Image32by32="/_imgs/ribbon/Sharing_32.png" ModernImage="Share" />
                        <Button Id="Mscrm.Form.account.Permissions.GrantNonRefresh" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Grant" Command="Mscrm.ShareSecuredFieldsPrimaryRecord" Sequence="20" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" Image16by16="/_imgs/ribbon/GrantPermissions_16.png" Image32by32="/_imgs/ribbon/GrantPermissions_32.png" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
                <Button Id="Mscrm.Form.account.Permissions.Sharing" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Share" Command="Mscrm.SharePrimaryRecordRefresh" Sequence="40" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" Image16by16="/_imgs/ribbon/Sharing_16.png" Image32by32="/_imgs/ribbon/Sharing_32.png" ModernImage="Share" />
                <Button Id="Mscrm.Form.account.Permissions.Grant" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Grant" Command="Mscrm.ShareSecuredFieldsPrimaryRecord" Sequence="50" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" Image16by16="/_imgs/ribbon/GrantPermissions_16.png" Image32by32="/_imgs/ribbon/GrantPermissions_32.png" />
                <Button Id="Mscrm.Form.account.Permissions.GrantUCI" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Grant" Command="Mscrm.ShareSecuredFieldsPrimaryRecordUCI" Sequence="50" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Grant" Image16by16="$webresource:AppCommon/_imgs/ico/16_SSF.svg" ModernImage="$webresource:AppCommon/_imgs/ico/16_SSF.svg" />
                <Button Id="Mscrm.Form.account.CopySelected" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" ToolTipDescription="$Resources:Ribbon.Tooltip.CopyShortcut" Command="Mscrm.CopyShortcutPrimary" Sequence="60" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" Alt="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" Image16by16="/_imgs/ribbon/copyshortcut16.png" Image32by32="/_imgs/ribbon/copyshortcut32.png" TemplateAlias="o2" />
                <Button Id="Mscrm.Form.account.FollowButton" Command="Mscrm.Form.FollowCommand" ToolTipTitle="$LocLabels:ActivityFeed.Follow.ToolTipTitle" ToolTipDescription="$LocLabels:ActivityFeed.FollowRecord.ToolTipDescription" LabelText="$LocLabels:ActivityFeed.Follow.LabelText" TemplateAlias="o2" Image16by16="/_imgs/ribbon/Entity16_8003.png" Image32by32="/_imgs/ribbon/Entity32_8003.png" Sequence="1010" ModernImage="RatingEmpty" />
                <Button Id="Mscrm.Form.account.UnfollowButton" Command="Mscrm.Form.UnfollowCommand" ToolTipTitle="$LocLabels:ActivityFeed.Unfollow.ToolTipTitle" ToolTipDescription="$LocLabels:ActivityFeed.UnfollowRecord.ToolTipDescription" LabelText="$LocLabels:ActivityFeed.Unfollow.LabelText" TemplateAlias="o2" Image16by16="/_imgs/ribbon/Entity16_8003_u.png" Image32by32="/_imgs/ribbon/Entity32_8003_u.png" Sequence="1010" ModernImage="RatingFull" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.Workflow" Command="Mscrm.Enabled" Sequence="45" Title="$Resources:Ribbon.HomepageGrid.Data.Workflow" Image32by32Popup="/_imgs/ribbon/runworkflow32.png" Template="Mscrm.Templates.Flexible">
              <Controls Id="Mscrm.Form.account.MainTab.Workflow.Controls">
                <Button Id="Mscrm.Form.account.RunWorkflow" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunWorkflow" Command="Mscrm.RunWorkflowPrimary" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" Alt="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" Image16by16="/_imgs/ribbon/StartWorkflow_16.png" Image32by32="/_imgs/ribbon/runworkflow32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.Form.account.RunScript" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunScript" Command="Mscrm.RunInteractiveWorkflowPrimary" Sequence="25" LabelText="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" Alt="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" Image16by16="/_imgs/ribbon/startdialog_16.png" Image32by32="/_imgs/ribbon/startdialog_32.png" TemplateAlias="o1" />
                <FlyoutAnchor Id="Mscrm.Form.account.Flows.RefreshCommandBar" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunFlow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunFlow" Sequence="30" Command="Mscrm.Form.Flows.ManageRunFlow" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.Flows" Alt="$Resources:RefreshCommandBar.Flows" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Form.Flows.PopulateMenu" TemplateAlias="o1" ModernImage="Flows" />
                <FlyoutAnchor Id="Mscrm.Form.account.Flows.RefreshCommandBar.Flows" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.Flows" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Flows" Sequence="35" Command="Mscrm.Form.Flows" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.Flows" Alt="$Resources:RefreshCommandBar.Flows" TemplateAlias="o1" ModernImage="Flows">
                  <Menu Id="Mscrm.Form.account.Flows.RefreshCommandBar.Flows.Menu">
                    <MenuSection Id="Mscrm.Form.account.Flows.RefreshCommandBar.Flows.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.Form.account.Flows.RefreshCommandBar.Flows.Controls">
                        <FlyoutAnchor Id="Mscrm.Form.account.Flows.RefreshCommandBar.ManageFlows" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.ManageFlows" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.ManageFlows" Sequence="10" Command="Mscrm.Form.Flows" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.ManageFlows" Alt="$Resources:RefreshCommandBar.ManageFlows" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Form.Flows.PopulateStaticFlowMenu" TemplateAlias="o1" ModernImage="Flows" />
                        <FlyoutAnchor Id="Mscrm.Form.account.Flows.RefreshCommandBar.RunFlow" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunFlow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunFlow" Sequence="20" Command="Mscrm.Form.Flows" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.RunFlow" Alt="$Resources:RefreshCommandBar.RunFlow" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Form.Flows.PopulateFlowMenu" TemplateAlias="o1" ModernImage="Flows" />
                        <FlyoutAnchor Id="Mscrm.Form.account.Flows.RefreshCommandBar.RunWorkflow" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunWorkflow" Sequence="30" Command="Mscrm.Form.Flows.RunWorkflow" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.RunWorkflow" Alt="$Resources:RefreshCommandBar.RunWorkflow" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Form.Flows.PopulateWorkFlowMenu" TemplateAlias="o1" ModernImage="Flows" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.MainTab.ExportData" Command="Mscrm.Enabled" Sequence="50" Title="$Resources:Ribbon.HomepageGrid.MainTab.ExportData" Image32by32Popup="/_imgs/ribbon/runreport32.png" Template="Mscrm.Templates.Flexible2">
              <Controls Id="Mscrm.Form.account.MainTab.ExportData.Controls">
                <FlyoutAnchor Id="Mscrm.Form.account.WordTemplate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" ToolTipDescription="$Resources:Ribbon.Tooltip.WordTemplate" Command="Mscrm.Form.WordTemplate" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.Form.WordTemplate.Populate.Flyout" Sequence="5" LabelText="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" Alt="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" Image16by16="/_imgs/ribbon/WordTemplate_16.png" Image32by32="/_imgs/ribbon/SaveAsWordTemplate_32.png" TemplateAlias="o1" ModernImage="WordTemplates" />
                <FlyoutAnchor Id="Mscrm.Form.account.Reports" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" ToolTipDescription="$Resources:Ribbon.Tooltip.RunReport" Command="Mscrm.ReportMenu.Form" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.ReportsMenu.Populate.Form" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" Alt="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" Image16by16="/_imgs/ribbon/RunReport_16.png" Image32by32="/_imgs/ribbon/runreport32.png" TemplateAlias="o1" ModernImage="Report" />
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.Form.account.Related" Command="Mscrm.Form.account.Related" Title="$Resources:Ribbon.HomepageGrid.Related.TabName" Description="$Resources:Ribbon.HomepageGrid.Related.TabName" Sequence="20">
          <Scaling Id="Mscrm.Form.account.Related.Scaling">
            <MaxSize Id="Mscrm.Form.account.Related.Document.MaxSize" GroupId="Mscrm.Form.account.Related.Document" Sequence="10" Size="Large" />
            <MaxSize Id="Mscrm.Form.account.Related.Activities.MaxSize" GroupId="Mscrm.Form.account.Related.Activities" Sequence="20" Size="MaxSize" />
            <MaxSize Id="Mscrm.Form.account.Related.Relationship.MaxSize" GroupId="Mscrm.Form.account.Related.Relationship" Sequence="21" Size="LargeMediumLargeMedium" />
            <MaxSize Id="Mscrm.Form.account.Related.Marketing.MaxSize" GroupId="Mscrm.Form.account.Related.Marketing" Sequence="30" Size="LargeLarge" />
            <Scale Id="Mscrm.Form.account.Related.Activities.Scale.1" GroupId="Mscrm.Form.account.Related.Activities" Sequence="40" Size="Scale.1" />
            <Scale Id="Mscrm.Form.account.Related.Activities.Scale.2" GroupId="Mscrm.Form.account.Related.Activities" Sequence="50" Size="Scale.2" />
            <Scale Id="Mscrm.Form.account.Related.Activities.Scale.3" GroupId="Mscrm.Form.account.Related.Activities" Sequence="60" Size="Scale.3" />
            <Scale Id="Mscrm.Form.account.Related.Document.Scale.1" GroupId="Mscrm.Form.account.Related.Document" Sequence="70" Size="Popup" />
            <Scale Id="Mscrm.Form.account.Related.Activities.Scale.4" GroupId="Mscrm.Form.account.Related.Activities" Sequence="80" Size="Popup" />
            <Scale Id="Mscrm.Form.account.Related.Relationship.Scale.1" GroupId="Mscrm.Form.account.Related.Relationship" Sequence="85" Size="Popup" />
            <Scale Id="Mscrm.Form.account.Related.Marketing.Scale.1" GroupId="Mscrm.Form.account.Related.Marketing" Sequence="90" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.Form.account.Related.Groups">
            <Group Id="Mscrm.Form.account.Related.Document" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.Add.Document" Image32by32Popup="/_imgs/ribbon/Attachment_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.Form.account.Related.Document.Controls">
                <Button Id="Mscrm.Form.account.AddFile" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Document_AddFile_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AttachFile" Command="Mscrm.AddFileToPrimaryRecord" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Add.Document.AddFile" Alt="$Resources:Ribbon.HomepageGrid.Add.Document.AddFile" Image16by16="/_imgs/ribbon/Attachment_16.png" Image32by32="/_imgs/ribbon/Attachment_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.Form.account.AddNote" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Document_AddNote_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddNote" Command="Mscrm.AddNoteToPrimaryRecord" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Add.Document.AddNote" Alt="$Resources:Ribbon.HomepageGrid.Add.Document.AddNote" Image16by16="/_imgs/ribbon/AddNote_16.png" Image32by32="/_imgs/ribbon/noteyellowadd32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.Related.Activities" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.Add.Activities" Image32by32Popup="/_imgs/ribbon/entity32_4212.png" Template="Mscrm.Templates.Activities">
              <Controls Id="Mscrm.Form.account.Related.Activities.Controls">
                <Button Id="Mscrm.Form.account.AddTask" Command="Mscrm.AddTaskToPrimaryRecord" Sequence="10" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddTask_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddTask" LabelText="{!EntityDisplayName:task}" Alt="{!EntityDisplayName:task}" Image16by16="/_imgs/ribbon/AddTask_16.png" Image32by32="/_imgs/ribbon/entity32_4212.png" TemplateAlias="c1" />
                <Button Id="Mscrm.Form.account.AddEmail" Command="Mscrm.SendEmailPrimaryRecord" Sequence="20" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddEmail_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddEmail" LabelText="{!EntityDisplayName:email}" Alt="{!EntityDisplayName:email}" Image16by16="/_imgs/ribbon/AddEmail_16.png" Image32by32="/_imgs/ribbon/Email_32.png" TemplateAlias="c2" />
                <Button Id="Mscrm.Form.account.AddPhone" Command="Mscrm.AddPhoneToPrimaryRecord" Sequence="30" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddPhone_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddPhoneCall" LabelText="{!EntityDisplayName:phonecall}" Alt="{!EntityDisplayName:phonecall}" Image16by16="/_imgs/ribbon/AddPhone_16.png" Image32by32="/_imgs/ribbon/entity32_4210.png" TemplateAlias="c3" />
                <Button Id="Mscrm.Form.account.AddLetter" Command="Mscrm.AddLetterToPrimaryRecord" Sequence="40" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddLetter_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddLetter" LabelText="{!EntityDisplayName:letter}" Alt="{!EntityDisplayName:letter}" Image16by16="/_imgs/ribbon/AddLetter_16.png" Image32by32="/_imgs/ribbon/entity32_4207.png" TemplateAlias="c4" />
                <Button Id="Mscrm.Form.account.AddFax" Command="Mscrm.AddFaxToPrimaryRecord" Sequence="50" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddFax_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddFax" LabelText="{!EntityDisplayName:fax}" Alt="{!EntityDisplayName:fax}" Image16by16="/_imgs/ribbon/AddFax_16.png" Image32by32="/_imgs/ribbon/entity32_4204.png" TemplateAlias="c5" />
                <Button Id="Mscrm.Form.account.AddAppointment" Command="Mscrm.AddAppointmentToPrimaryRecord" Sequence="60" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddAppointment_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddAppointment" LabelText="{!EntityDisplayName:appointment}" Alt="{!EntityDisplayName:appointment}" Image16by16="/_imgs/ribbon/AddAppointment_16.png" Image32by32="/_imgs/ribbon/entity32_4201.png" TemplateAlias="c6" />
                <Button Id="Mscrm.Form.account.AddRecurringAppointment" Command="Mscrm.AddRecurringAppointmentToPrimaryRecord" Sequence="70" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddRecurringAppointment_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddRecurringAppointment" LabelText="{!EntityDisplayName:recurringappointmentmaster}" Alt="{!EntityDisplayName:recurringappointmentmaster}" Image16by16="/_imgs/ribbon/RecurringAppointmentInstance_16.png" Image32by32="/_imgs/ribbon/RecurringAppointmentInstance_32.png" TemplateAlias="c7" />
                <Button Id="Mscrm.Form.account.AddServiceActivity" Command="Mscrm.AddServiceActivityToPrimaryRecord" Sequence="80" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddServiceActivity_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddServiceActivity" LabelText="{!EntityDisplayName:serviceappointment}" Alt="{!EntityDisplayName:serviceappointment}" Image16by16="/_imgs/ribbon/AddServiceActivity_16.png" Image32by32="/_imgs/ribbon/AddServiceActivity_32.png" TemplateAlias="c8" />
                <FlyoutAnchor Id="Mscrm.Form.account.AddOtherActivities" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Add.Related.OtherActivities" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddOtherActivities" Command="Mscrm.Form.AddCustomActivity" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Form.AddActivity" Sequence="90" LabelText="$Resources:Ribbon.HomepageGrid.Add.Related.OtherActivities" Alt="$Resources:Ribbon.HomepageGrid.Add.Related.OtherActivities" Image16by16="/_imgs/ribbon/AddActivity_16.png" Image32by32="/_imgs/ribbon/AddActivity_32.png" TemplateAlias="c9" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.Related.Marketing" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.account.Add.Marketing" Image32by32Popup="/_imgs/ribbon/mailmerge32.png" Template="Mscrm.Templates.3.3">
              <Controls Id="Mscrm.Form.account.Related.Marketing.Controls">
                <Button Id="Mscrm.Form.account.MailMerge" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.MailMerge" Command="Mscrm.MailMergePrimary" Sequence="10" Alt="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" LabelText="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" Image16by16="/_imgs/ribbon/mailmerge16.png" Image32by32="/_imgs/ribbon/mailmerge32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.Form.account.AddCampaignResponse" Command="Mscrm.AddCampaignResponseToPrimaryRecord" Sequence="80" ToolTipTitle="$Resources:Mscrm_Form_Other_Related_Activities_AddCampaignResponse_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.AddCampaignResponse" LabelText="{!EntityDisplayName:campaignresponse}" Alt="{!EntityDisplayName:campaignresponse}" Image16by16="/_imgs/ribbon/AddCampaignResponse_16.png" Image32by32="/_imgs/ribbon/entity32_4401.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.Related.Relationship" Command="Mscrm.Enabled" Sequence="30" Title="$LocLabels:Ribbon.HomepageGrid.account.Relationship" Image32by32Popup="$webresource:Sales/_imgs/ribbon/Relationship_32.png" Template="Mscrm.Templates.FourOverflow">
              <Controls Id="Mscrm.Form.account.Related.Relationship.Record.Controls">
                <FlyoutAnchor Id="Mscrm.Form.account.Relationship" ToolTipTitle="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.AddRelationship" Command="Mscrm.Form.account.Relationship" Sequence="40" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship" Image16by16="$webresource:Sales/_imgs/ribbon/Relationship_16.png" Image32by32="$webresource:Sales/_imgs/ribbon/Relationship_32.png" TemplateAlias="o1">
                  <Menu Id="Mscrm.Form.account.Relationship.Menu">
                    <MenuSection Id="Mscrm.Form.account.Relationship.MenuSection" Sequence="10" DisplayMode="Menu16">
                      <Controls Id="Mscrm.Form.account.Relationship.Controls">
                        <Button Id="Mscrm.Form.account.Relationship.Customer" Command="Mscrm.Form.account.Relationship.Customer" Sequence="20" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship.Customer" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.Other.Relationship.Customer" Image16by16="$webresource:Sales/_imgs/ribbon/CustomerRelationship_16.png" Image32by32="$webresource:Sales/_imgs/ribbon/Relationship_32.png" ToolTipTitle="$LocLabels:Mscrm_Form_account_Related_Relationship_Relationship_Customer_ToolTipTitle" ToolTipDescription="$LocLabels:Mscrm_Form_account_Related_Relationship_Relationship_Customer_ToolTipDescription" />
                      </Controls>
                    </MenuSection>
                  </Menu>
                </FlyoutAnchor>
              </Controls>
            </Group>
          </Groups>
        </Tab>
        <Tab Id="Mscrm.Form.account.Developer" Command="Mscrm.Form.account.Developer" Title="$Resources:Ribbon.HomepageGrid.Developer.TabName" Description="$Resources:Ribbon.HomepageGrid.Developer.TabName" Sequence="30">
          <Scaling Id="Mscrm.Form.account.Developer.Scaling">
            <MaxSize Id="Mscrm.Form.account.Developer.Design.MaxSize" GroupId="Mscrm.Form.account.Developer.Design" Sequence="10" Size="Large" />
            <MaxSize Id="Mscrm.Form.account.Developer.Customize.MaxSize" GroupId="Mscrm.Form.account.Developer.Customize" Sequence="20" Size="Large" />
            <MaxSize Id="Mscrm.Form.account.Developer.Publish.MaxSize" GroupId="Mscrm.Form.account.Developer.Publish" Sequence="30" Size="Large" />
            <Scale Id="Mscrm.Form.account.Developer.Customize.Scale.1" GroupId="Mscrm.Form.account.Developer.Customize" Sequence="40" Size="Popup" />
            <Scale Id="Mscrm.Form.account.Developer.Publish.Scale.1" GroupId="Mscrm.Form.account.Developer.Publish" Sequence="60" Size="Popup" />
          </Scaling>
          <Groups Id="Mscrm.Form.account.Developer.Groups">
            <Group Id="Mscrm.Form.account.Developer.Design" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.Developer.Design" Description="$Resources:Ribbon.HomepageGrid.Developer.Design" Image32by32Popup="/_imgs/ribbon/EditForm_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.Form.account.Developer.Design.Controls" />
            </Group>
            <Group Id="Mscrm.Form.account.Developer.Customize" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.Developer.Customize" Description="$Resources:Ribbon.HomepageGrid.Developer.Customize" Image32by32Popup="/_imgs/ribbon/CustomizeEntity_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.Form.account.Developer.Customize.Controls">
                <Button Id="Mscrm.Form.account.CustomizeEntity" ToolTipTitle="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity" ToolTipDescription="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity.TooTipDesc" Command="Mscrm.CustomizeEntity" Sequence="10" LabelText="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity" Alt="$Resources:Ribbon.Form.Developer.Customize.CustomizeEntity" Image16by16="/_imgs/ribbon/CustomEntity_16.png" Image32by32="/_imgs/ribbon/CustomizeEntity_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
            <Group Id="Mscrm.Form.account.Developer.Publish" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.Form.Developer.Customize.Publish" Description="$Resources:Ribbon.Form.Developer.Customize.Publish" Image32by32Popup="/_imgs/ribbon/PublishEntity_32.png" Template="Mscrm.Templates.3">
              <Controls Id="Mscrm.Form.account.Developer.Publish.Controls">
                <Button Id="Mscrm.Form.account.PublishEntity" Command="Mscrm.PublishEntity" Sequence="10" ToolTipTitle="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity" ToolTipDescription="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity.TooTipDesc" LabelText="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity" Alt="$Resources:Ribbon.Form.Developer.Customize.Publish.Entity" Image16by16="/_imgs/ribbon/PublishEntity_16.png" Image32by32="/_imgs/ribbon/PublishEntity_32.png" TemplateAlias="o1" />
                <Button Id="Mscrm.Form.account.PublishAll" Command="Mscrm.PublishAll" Sequence="20" ToolTipTitle="$Resources:Ribbon.Form.Developer.Customize.PublishAll" ToolTipDescription="$Resources:Ribbon.Form.Developer.Customize.PublishAll.TooTipDesc" LabelText="$Resources:Ribbon.Form.Developer.Customize.PublishAll" Alt="$Resources:Ribbon.Form.Developer.Customize.PublishAll" Image16by16="/_imgs/ribbon/PublishAll_16.png" Image32by32="/_imgs/ribbon/PublishAll_32.png" TemplateAlias="o1" />
              </Controls>
            </Group>
          </Groups>
        </Tab>
      </Tabs>
      <ContextualTabs Id="Mscrm.ContextualTabs">
        <ContextualGroup Id="Mscrm.VisualizationTools" Command="Mscrm.VisualizationTools.Command" Color="Orange" ContextualGroupId="Mscrm.VisualizationTools" Title="$Resources:Ribbon.VisualizationTools.FlareHeading" Sequence="1000">
          <Tab Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab" Command="Mscrm.VisualizationTab.Command" Description="$Resources:Ribbon.VisualizationTab.Description" Title="$Resources:Ribbon.VisualizationTab.TabHeading" Sequence="10">
            <Scaling Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Scaling">
              <MaxSize Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.MaxSize" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save" Sequence="10" Size="Large" />
              <MaxSize Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.MaxSize" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts" Sequence="20" Size="Large" />
              <MaxSize Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.MaxSize" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom" Sequence="30" Size="Large" />
              <MaxSize Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Close.MaxSize" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Close" Sequence="40" Size="Large" />
              <Scale Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Medium" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts" Sequence="50" Size="MediumMedium" />
              <Scale Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.Medium" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save" Sequence="60" Size="Medium" />
              <Scale Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Medium" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom" Sequence="70" Size="Medium" />
              <Scale Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Popup" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts" Sequence="80" Size="Popup" />
              <Scale Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.Popup" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save" Sequence="90" Size="Popup" />
              <Scale Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Popup" GroupId="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom" Sequence="100" Size="Popup" />
            </Scaling>
            <Groups Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Groups">
              <Group Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save" Command="Mscrm.Enabled" Sequence="20" Description="$Resources:Ribbon.VisualizationTab.Save.Description" Title="$Resources:Ribbon.VisualizationTab.Save.Title" Image32by32Popup="/_imgs/ribbon/Save_32.png" Template="Mscrm.Templates.OneLargeTwoMedium">
                <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.Controls">
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.Save" Command="Mscrm.VisualizationTab.SaveChart" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.Save.Save.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Save.Save.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Save.Save.ToolTipDescription" Image16by16="/_imgs/ribbon/savechart16.png" Image32by32="/_imgs/ribbon/Save_32.png" TemplateAlias="o1" />
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.SaveAndClose" Command="Mscrm.VisualizationTab.SaveAndCloseChart" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.Save.SaveAndClose.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Save.SaveAndClose.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Save.SaveAndClose.ToolTipDescription" Image16by16="/_imgs/FormEditorRibbon/SaveAndClose_16.png" Image32by32="/_imgs/ribbon/SaveAndCloseChart_32.png" TemplateAlias="o2" />
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Save.Copy" Command="Mscrm.VisualizationTab.CopyChart" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.Save.Copy.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Save.Copy.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Save.Copy.ToolTipDescription" Image16by16="/_imgs/ribbon/SaveAsChart16.png" Image32by32="/_imgs/ribbon/saveaschart32.png" TemplateAlias="o2" />
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.ExpandChart" Command="Mscrm.VisualizationTab.ExpandChart" Sequence="35" LabelText="$Resources:Ribbon.VisualizationTab.Management.Expand.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Management.Expand.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Management.Expand.ToolTipDescription" Image16by16="/_imgs/ribbon/ExpandChart16.png" Image32by32="/_imgs/ribbon/expandchart32.png" TemplateAlias="o2" />
                </Controls>
              </Group>
              <Group Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts" Command="Mscrm.VisualizationTab.ChartsGroup" Sequence="30" Description="$Resources:Ribbon.VisualizationTab.Charts.Description" Title="$Resources:Ribbon.VisualizationTab.Charts.Title" Image32by32Popup="/_imgs/ribbon/ChartsBarGraph_32.png" Template="Mscrm.Templates.VisualizationDesigner.Charts">
                <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Controls">
                  <FlyoutAnchor Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.ColumnFlyout" Command="Mscrm.VisualizationDesignerTab.ColumnFlyout" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.Charts.ColumnFlyout" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.ColumnFlyout" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.ColumnFlyout.ToolTip" Image16by16="/_imgs/ribbon/ColumnChart16.png" Image32by32="/_imgs/ribbon/ColumnChart32.png" TemplateAlias="o1">
                    <Menu Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Column.Menu">
                      <MenuSection Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Column.MenuSection0" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Column.Controls0">
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Column.Column" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Column" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Column.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.Column" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Column" Alt="$Resources:Ribbon.VisualizationTab.Charts.Column" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Column.StackedColumn" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.StackedColumn" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn" Alt="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Column.StackedColumn100" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn100" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn100.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.StackedColumn100" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn100" Alt="$Resources:Ribbon.VisualizationTab.Charts.StackedColumn100" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <FlyoutAnchor Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.BarFlyout" Command="Mscrm.VisualizationDesignerTab.BarFlyout" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Bar" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Bar" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Bar.Tooltip" Image16by16="/_imgs/ribbon/BarChart16.png" Image32by32="/_imgs/ribbon/BarChart32.png" TemplateAlias="o1">
                    <Menu Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Bar.Menu">
                      <MenuSection Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Bar.MenuSection0" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Bar.Controls0">
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Bar.Bar" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Bar" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Bar.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.Bar" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Bar" Alt="$Resources:Ribbon.VisualizationTab.Charts.Bar" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Bar.StackedBar" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.StackedBar" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.StackedBar.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.StackedBar" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.Charts.StackedBar" Alt="$Resources:Ribbon.VisualizationTab.Charts.StackedBar" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Bar.StackedBar100" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.StackedBar100" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.StackedBar100.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.StackedBar100" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.Charts.StackedBar100" Alt="$Resources:Ribbon.VisualizationTab.Charts.StackedBar100" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <FlyoutAnchor Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.AreaFlyout" Command="Mscrm.VisualizationDesignerTab.AreaFlyout" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Area" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Area" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Area.Tooltip" Image16by16="/_imgs/visualization/areaChart_16.png" Image32by32="/_imgs/visualization/areaChart_32.png" TemplateAlias="o1">
                    <Menu Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Area.Menu">
                      <MenuSection Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Area.MenuSection0" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Area.Controls0">
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Area.Area" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Area" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Area.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.Area" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Area" Alt="$Resources:Ribbon.VisualizationTab.Charts.Area" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Area.StackedArea" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.StackedArea" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.StackedArea.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.StackedArea" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.Charts.StackedArea" Alt="$Resources:Ribbon.VisualizationTab.Charts.StackedArea" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Area.StackedArea100" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.StackedArea100" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.StackedArea100.Tooltip" Command="Mscrm.VisualizationDesignerTab.Charts.StackedArea100" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.Charts.StackedArea100" Alt="$Resources:Ribbon.VisualizationTab.Charts.StackedArea100" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Line" Command="Mscrm.VisualizationDesignerTab.LineChart" Sequence="40" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Line" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Line" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Line.ToolTip" Image16by16="/_imgs/ribbon/linechart16.png" Image32by32="/_imgs/ribbon/linechart32.png" TemplateAlias="o1" />
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Pie" Command="Mscrm.VisualizationDesignerTab.PieChart" Sequence="50" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Pie" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Pie" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Pie.ToolTip" Image16by16="/_imgs/ribbon/piechart16.png" Image32by32="/_imgs/ribbon/piechart32.png" TemplateAlias="o1" />
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Charts.Other" Command="Mscrm.VisualizationDesignerTab.FunnelChart" Sequence="60" LabelText="$Resources:Ribbon.VisualizationTab.Charts.Funnel" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Charts.Funnel" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Charts.Funnel.ToolTip" Image16by16="/_imgs/ribbon/funnelchart16.png" Image32by32="/_imgs/ribbon/funnelchart32.png" TemplateAlias="o1" />
                </Controls>
              </Group>
              <Group Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom" Command="Mscrm.VisualizationTab.ChartsGroup" Sequence="40" Description="$Resources:Ribbon.VisualizationTab.TopBottom.Description" Title="$Resources:Ribbon.VisualizationTab.TopBottom.Title" Image32by32Popup="/_imgs/placeholders/ribbon_placeholder_32.png" Template="Mscrm.Templates.ThreeLargeThreeMedium">
                <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Controls">
                  <FlyoutAnchor Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.TopFlyout" Command="Mscrm.VisualizationDesignerTab.TopFlyout" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Top" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Top" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Top.ToolTip" Image16by16="/_imgs/visualization/topRules_16.png" Image32by32="/_imgs/visualization/topRules_32.png" TemplateAlias="o1">
                    <Menu Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Top.Menu">
                      <MenuSection Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Top.MenuSection0" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Top.Controls0">
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Top3" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Top3" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Top3.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.Top3" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Top3" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.Top3" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Top5" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Top5" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Top5.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.Top5" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Top5" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.Top5" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.TopX" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.TopX" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.TopX.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.TopX" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.TopX" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.TopX" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <FlyoutAnchor Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.BottomFlyout" Command="Mscrm.VisualizationDesignerTab.BottomFlyout" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom.ToolTip" Image16by16="/_imgs/visualization/bottomRules_16.png" Image32by32="/_imgs/visualization/bottomRules_32.png" TemplateAlias="o2">
                    <Menu Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Bottom.Menu">
                      <MenuSection Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Bottom.MenuSection0" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Bottom.Controls0">
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Bottom3" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom3" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom3.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.Bottom3" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom3" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom3" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Bottom5" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom5" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom5.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.Bottom5" Sequence="20" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom5" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.Bottom5" />
                          <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.BottomX" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.BottomX" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.BottomX.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.BottomX" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.BottomX" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.BottomX" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.TopBottom.Clear" ToolTipTitle="$Resources:Ribbon.VisualizationTab.TopBottom.Clear" ToolTipDescription="$Resources:Ribbon.VisualizationTab.TopBottom.Clear.ToolTip" Command="Mscrm.VisualizationDesignerTab.TopBottom.Clear" Sequence="30" LabelText="$Resources:Ribbon.VisualizationTab.TopBottom.Clear" Alt="$Resources:Ribbon.VisualizationTab.TopBottom.Clear.ToolTip" Image16by16="/_imgs/visualization/clearRules_16.png" TemplateAlias="o2" />
                </Controls>
              </Group>
              <Group Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Close" Command="Mscrm.Enabled" Sequence="70" Description="$Resources:Ribbon.VisualizationTab.Close.Description" Title="$Resources:Ribbon.VisualizationTab.Close.Title" Image32by32Popup="/_imgs/ribbon/Close_32.png" Template="Mscrm.Templates.Flexible">
                <Controls Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Close.Controls">
                  <Button Id="Mscrm.HomepageGrid.AllEntities.VisualizationTab.Close.Close" Command="Mscrm.VisualizationTab.CloseDesigner" Sequence="10" LabelText="$Resources:Ribbon.VisualizationTab.Close.Close.Label" ToolTipTitle="$Resources:Ribbon.VisualizationTab.Close.Close.ToolTipTitle" ToolTipDescription="$Resources:Ribbon.VisualizationTab.Close.Close.ToolTipDescription" Image16by16="/_imgs/ribbon/Close_16.png" Image32by32="/_imgs/ribbon/Close_32.png" TemplateAlias="o1" />
                </Controls>
              </Group>
            </Groups>
          </Tab>
        </ContextualGroup>
        <ContextualGroup Id="Mscrm.SubGrid.account.ContextualTabs" Command="Mscrm.SubGrid.account.ContextualTabs" Color="LightBlue" ContextualGroupId="Mscrm.SubGrid.account.ContextualTabs" Title="$Resources:Ribbon.SubGridFlare" Sequence="10">
          <Tab Id="Mscrm.SubGrid.account.MainTab" Command="Mscrm.SubGrid.account.MainTab" Title="Accounts" Description="Account" Sequence="10">
            <Scaling Id="Mscrm.SubGrid.account.MainTab.Scaling">
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.Management.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.Management" Sequence="10" Size="LargeMedium" />
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.Actions.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.Actions" Sequence="20" Size="LargeMediumLargeLarge" />
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.Collaborate.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.Collaborate" Sequence="30" Size="LargeMediumLargeMedium" />
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.Filters.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.Filters" Sequence="40" Size="LargeMedium" />
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.Layout.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.Layout" Sequence="50" Size="Large" />
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.Workflow.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.Workflow" Sequence="60" Size="Large" />
              <MaxSize Id="Mscrm.SubGrid.account.MainTab.ExportData.MaxSize" GroupId="Mscrm.SubGrid.account.MainTab.ExportData" Sequence="80" Size="LargeMediumLarge" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Filters.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.Filters" Sequence="90" Size="LargeSmall" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.ExportData.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.ExportData" Sequence="110" Size="LargeSmallLarge" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Actions.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.Actions" Sequence="120" Size="LargeSmallLargeSmall" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Management.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.Management" Sequence="130" Size="LargeSmall" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Collaborate.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.Collaborate" Sequence="140" Size="LargeSmallLargeSmall" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Filters.Scale.2" GroupId="Mscrm.SubGrid.account.MainTab.Filters" Sequence="150" Size="Popup" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.ExportData.Scale.2" GroupId="Mscrm.SubGrid.account.MainTab.ExportData" Sequence="170" Size="Popup" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Management.Scale.2" GroupId="Mscrm.SubGrid.account.MainTab.Management" Sequence="180" Size="Popup" PopupSize="LargeSmall" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Actions.Scale.2" GroupId="Mscrm.SubGrid.account.MainTab.Actions" Sequence="190" Size="Popup" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Layout.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.Layout" Sequence="200" Size="Popup" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Workflow.Scale.1" GroupId="Mscrm.SubGrid.account.MainTab.Workflow" Sequence="210" Size="Popup" />
              <Scale Id="Mscrm.SubGrid.account.MainTab.Collaborate.Scale.2" GroupId="Mscrm.SubGrid.account.MainTab.Collaborate" Sequence="220" Size="Popup" />
            </Scaling>
            <Groups Id="Mscrm.SubGrid.account.MainTab.Groups">
              <Group Id="Mscrm.SubGrid.account.MainTab.Management" Command="Mscrm.Enabled" Sequence="10" Title="$Resources:Ribbon.HomepageGrid.MainTab.Management" Description="$Resources:Ribbon.HomepageGrid.MainTab.Management" Image32by32Popup="/_imgs/ribbon/newrecord32.png" Template="Mscrm.Templates.Flexible2">
                <Controls Id="Mscrm.SubGrid.account.MainTab.Management.Controls">
                  <Button Id="MailApp.SubGrid.SetRegarding.account.Button" Command="MailApp.SubGrid.SetRegardingCommand" Sequence="1" LabelText="$LocLabels:MailApp.SubGrid.SetRegarding.Button.Label" ToolTipTitle="$LocLabels:MailApp.SubGrid.SetRegarding.Button.ToolTip" TemplateAlias="o1" ModernImage="LinkArticle" />
                  <Button Id="Mscrm.SubGrid.account.NewRecord" ToolTipTitle="$Resources(EntityDisplayName):Ribbon.SubGrid.MainTab.New" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.New" Command="Mscrm.NewRecordFromGrid" Sequence="10" LabelText="$Resources(EntityDisplayName):Ribbon.SubGrid.MainTab.New" Image16by16="/_imgs/ribbon/New_16.png" Image32by32="/_imgs/ribbon/newrecord32.png" TemplateAlias="o1" ModernImage="New" />
                  <Button Id="Mscrm.SubGrid.account.AddListMember" ToolTipTitle="$LocLabels:Ribbon.SubGrid.account.AddListMember" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.AddListMember" Command="Mscrm.AddMembers" Sequence="11" Alt="$LocLabels:Ribbon.SubGrid.account.AddListMember" LabelText="$LocLabels:Ribbon.SubGrid.account.AddListMember" ModernImage="BulletListAdd" TemplateAlias="o1" />
                  <Button Id="Mscrm.SubGrid.account.OpenAssociatedGridViewStandard" Command="Mscrm.OpenAssociatedGridViewOnLiteGridStandard" Sequence="15" LabelText="$Resources(EntityDisplayName):Ribbon.SubGrid.OpenAssociatedGridView" Alt="$Resources(EntityDisplayName):Ribbon.SubGrid.OpenAssociatedGridView" Image16by16="/_imgs/ribbon/OpenAssociatedGridView16.png" Image32by32="/_imgs/ribbon/OpenAssociatedGridView32.png" TemplateAlias="o1" ToolTipTitle="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_OpenAssociatedGridViewStandard_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_OpenAssociatedGridViewStandard_ToolTipDescription" />
                  <Button Id="Mscrm.SubGrid.account.AddNewStandard" Command="Mscrm.AddNewRecordFromSubGridStandard" Sequence="20" LabelText="$Resources(EntityDisplayName):Ribbon.SubGrid.AddNew" Alt="$Resources(EntityDisplayName):Ribbon.SubGrid.AddNew" Image16by16="/_imgs/ribbon/New_16.png" Image32by32="/_imgs/ribbon/newrecord32.png" TemplateAlias="o1" ToolTipTitle="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_AddNewStandard_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_AddNewStandard_ToolTipDescription" ModernImage="New" />
                  <Button Id="Mscrm.SubGrid.account.AddExistingStandard" Command="Mscrm.AddExistingRecordFromSubGridStandard" Sequence="30" LabelText="$Resources(EntityDisplayName):Ribbon.SubGrid.AddExisting" Alt="$Resources(EntityDisplayName):Ribbon.SubGrid.AddExisting" Image16by16="/_imgs/ribbon/AddExistingStandard_16.png" Image32by32="/_imgs/ribbon/AddExistingStandard_32.png" TemplateAlias="o1" ToolTipTitle="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_AddExistingStandard_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_AddExistingStandard_ToolTipDescription" ModernImage="AddExisting" />
                  <Button Id="Mscrm.SubGrid.account.AddExistingAssoc" Command="Mscrm.AddExistingRecordFromSubGridAssociated" Sequence="40" LabelText="$Resources(EntityDisplayName):Ribbon.SubGrid.AddExisting" Alt="$Resources(EntityDisplayName):Ribbon.SubGrid.AddExisting" Image16by16="/_imgs/ribbon/AddExistingStandard_16.png" Image32by32="/_imgs/ribbon/AddExistingStandard_32.png" TemplateAlias="o1" ToolTipTitle="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_AddExistingAssoc_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_AddExistingAssoc_ToolTipDescription" ModernImage="AddExisting" />
                  <Button Id="Mscrm.SubGrid.account.Edit" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Management.Edit" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.Edit" Command="Mscrm.EditSelectedRecord" Sequence="50" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.Edit" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Management.Edit" Image16by16="/_imgs/ribbon/Edit_16.png" Image32by32="/_imgs/ribbon/edit32.png" TemplateAlias="o1" ModernImage="Edit" />
                  <Button Id="Mscrm.SubGrid.account.Activate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Activate" Command="Mscrm.HomepageGrid.Activate" Sequence="60" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" Image16by16="/_imgs/ribbon/Activate_16.png" Image32by32="/_imgs/ribbon/Activate_32.png" TemplateAlias="o2" ModernImage="Activate" />
                  <Button Id="Mscrm.SubGrid.account.Deactivate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Deactivate" Command="Mscrm.HomepageGrid.Deactivate" Sequence="70" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" Image16by16="/_imgs/ribbon/Deactivate_16.png" Image32by32="/_imgs/ribbon/Deactivate_32.png" TemplateAlias="o2" ModernImage="DeActivate" />
                  <Button Alt="$LocLabels:msdyn.ApplicationRibbon.SubGrid.BookResource.Button.Alt" Command="msdyn.ApplicationRibbon.HomeGrid.BookResource.Command" Description="Book" Id="msdyn.ApplicationRibbon.account.SubGrid.BookResource.Button" ModernImage="$webresource:msdyn_/fps/Icons/CommandBar/CalendarButton.svg" LabelText="$LocLabels:msdyn.ApplicationRibbon.SubGrid.BookResource.Button.LabelText" Sequence="75" TemplateAlias="o2" ToolTipTitle="$LocLabels:msdyn.ApplicationRibbon.SubGrid.BookResource.Button.ToolTipTitle" ToolTipDescription="$LocLabels:msdyn.ApplicationRibbon.SubGrid.BookResource.Button.ToolTipDescription" />
                  <Button Id="Mscrm.SubGrid.account.Delete" ToolTipTitle="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_Delete_ToolTipTitle" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.HomepageGrid.Tooltip.Delete" Command="Mscrm.DeleteSelectedRecord" Sequence="80" LabelText="$Resources(EntityDisplayName):Ribbon.SubGrid.MainTab.Management.Delete" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Management.Delete" Image16by16="/_imgs/ribbon/Delete_16.png" Image32by32="/_imgs/Workplace/remove_32.png" TemplateAlias="o2" ModernImage="Remove" />
                  <Button Id="Mscrm.SubGrid.account.Remove" Command="Mscrm.RemoveSelectedRecord" Sequence="90" LabelText="$Resources:MenuItem_Label_Remove" Alt="$Resources:MenuItem_Label_Remove" Image16by16="/_imgs/ribbon/Delete_16.png" Image32by32="/_imgs/Workplace/Remove_32.png" TemplateAlias="o2" ToolTipTitle="$Resources:Mscrm_SubGrid_Other_MainTab_Management_Remove_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_SubGrid_Other_MainTab_Management_Remove_ToolTipDescription" ModernImage="Remove" />
                  <Button Id="Mscrm.SubGrid.account.BulkDelete" Command="Mscrm.HomepageGrid.BulkDelete" Sequence="100" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Management.BulkDelete" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Management.BulkDelete" ToolTipDescription="$Resources:Ribbon.HomepageGrid.MainTab.Management.BulkDelete.TooltipDescription" Image16by16="/_imgs/ribbon/BulkDelete_16.png" Image32by32="/_imgs/ribbon/BulkDelete_32.png" TemplateAlias="o2" ModernImage="DeleteBulk" />
                  <Button Id="Mscrm.SubGrid.account.MergeRecords" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" ToolTipDescription="$Resources:Ribbon.Tooltip.Merge" Command="Mscrm.HomepageGrid.account.MergeRecords" Sequence="109" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" Image16by16="/_imgs/ribbon/MergeRecords_16.png" Image32by32="/_imgs/ribbon/MergeRecords_32.png" TemplateAlias="o2" ModernImage="MergeRecords" />
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.Detect" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.DetectDuplicates" Command="Mscrm.HomepageGrid.DetectDupes" Sequence="110" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect" Image16by16="/_imgs/ribbon/DuplicateDetection_16.png" Image32by32="/_imgs/ribbon/DuplicateDetection_32.png" TemplateAlias="o2">
                    <Menu Id="Mscrm.SubGrid.account.Detect.Menu">
                      <MenuSection Id="Mscrm.SubGrid.account.Detect.MenuSection" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.SubGrid.account.Detect.Controls">
                          <Button Id="Mscrm.SubGrid.account.Detect.Selected" Command="Mscrm.HomepageGrid.DetectDupesSelected" Sequence="10" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.Selected" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.Selected" Image16by16="/_imgs/ribbon/SelectedRecords_16.png" Image32by32="/_imgs/ribbon/DuplicateDetection_32.png" ToolTipTitle="$Resources:Mscrm_SubGrid_Other_MainTab_Management_Detect_Selected_ToolTipTitle" ToolTipDescription="$Resources:Mscrm_SubGrid_Other_MainTab_Management_Detect_Selected_ToolTipDescription" />
                          <Button Id="Mscrm.SubGrid.account.Detect.All" Command="Mscrm.HomepageGrid.DetectDupesAll" Sequence="20" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.All" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Dupe.Detect.All" Image16by16="/_imgs/ribbon/DetectAll_16.png" Image32by32="/_imgs/ribbon/DetectAll_32.png" ToolTipTitle="$Resources:Mscrm_SubGrid_Other_MainTab_Management_Detect_All_ToolTipTitle" ToolTipDescription="$Resources(EntityDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Management_Detect_All_ToolTipDescription" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.ChangeDataSetControlButton" ToolTipTitle="$Resources:MobileClient.Commands.ChangeControl" ToolTipDescription="$Resources:WebClient.Commands.ChangeControl.Description" Command="Mscrm.ChangeControlCommand" Sequence="25" LabelText="$Resources:MobileClient.Commands.ChangeControl" Alt="$Resources:WebClient.Commands.ChangeControl.Description" Image16by16="/_imgs/ribbon/SendView_16.png" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.ChangeControlCommand" TemplateAlias="o1" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.ModernClient" Command="Mscrm.Enabled" Sequence="11" Template="Mscrm.Templates.Flexible">
                <Controls Id="Mscrm.SubGrid.account.MainTab.ModernClient.Controls">
                  <Button Id="Mscrm.SubGrid.account.RefreshButton" Command="Mscrm.Modern.refreshCommand" ModernCommandType="ControlCommand" Sequence="17" LabelText="$Resources:MobileClient.Commands.Refresh" ModernImage="Refresh" TemplateAlias="o1" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.Actions" Command="Mscrm.Enabled" Sequence="20" Title="$Resources:Ribbon.HomepageGrid.MainTab.Actions" Image32by32Popup="/_imgs/ribbon/Actions_32.png" Template="Mscrm.Templates.Flexible4">
                <Controls Id="Mscrm.SubGrid.account.MainTab.Actions.Controls">
                  <Button Id="Mscrm.SubGrid.account.CreateOpportunityForMembers" ToolTipTitle="$LocLabels:Ribbon.Account.CreateOpportunityForMembers" ToolTipDescription="$LocLabels:Ribbon.Account.CreateOpportunityForMembers.ToolTip" Command="Mscrm.CreateOpportunityForMembers" Sequence="70" Alt="$LocLabels:Ribbon.Account.CreateOpportunityForMembers" LabelText="$LocLabels:Ribbon.Account.CreateOpportunityForMembers" Image16by16="$webresource:Marketing/_images/SFA/CreateOpportunityForMembers_16.png" Image32by32="$webresource:Marketing/_images/SFA/CreateOpportunityForMembers_32.png" TemplateAlias="o2" ModernImage="OpportunitiesList" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.Collaborate" Command="Mscrm.Enabled" Sequence="30" Title="$Resources:Ribbon.HomepageGrid.MainTab.Collaborate" Image32by32Popup="/_imgs/ribbon/Assign_32.png" Template="Mscrm.Templates.Flexible4">
                <Controls Id="Mscrm.SubGrid.account.MainTab.Collaborate.Controls">
                  <Button Id="Mscrm.SubGrid.account.AddEmail" Command="Mscrm.AddEmailToSelectedRecord" Sequence="10" ToolTipTitle="$Resources:Ribbon.HomepageGrid.SendDirectEmail.ToolTip" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.DirectEmail" LabelText="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Alt="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Image16by16="/_imgs/ribbon/AddEmail_16.png" Image32by32="/_imgs/ribbon/Email_32.png" TemplateAlias="o1" ModernImage="EmailLink" />
                  <Button Id="Mscrm.SubGrid.account.modern.AddEmail" Command="Mscrm.modern.AddEmailToSelectedRecord" Sequence="10" ToolTipTitle="$Resources:Ribbon.HomepageGrid.SendDirectEmail.ToolTip" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.DirectEmail" LabelText="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Alt="$Resources:Ribbon.HomepageGrid.SendDirectEmail" Image16by16="/_imgs/ribbon/AddEmail_16.png" Image32by32="/_imgs/ribbon/Email_32.png" TemplateAlias="o1" ModernImage="EmailLink" />
                  <Button Id="Mscrm.SubGrid.account.AddToList" ToolTipTitle="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.AddToMarketingList" Command="Mscrm.AddSelectedToMarketingList" Sequence="11" Alt="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" LabelText="$LocLabels:Ribbon.HomepageGrid.account.Add.AddToList" Image16by16="$webresource:Marketing/_images/ribbon/AddToMarketingList_16.png" Image32by32="$webresource:Marketing/_images/ribbon/AddToMarketingList_32.png" TemplateAlias="o1" />
                  <Button Id="Mscrm.SubGrid.account.CopyListMember" ToolTipTitle="$LocLabels:Ribbon.SubGrid.account.CopyListMember" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.CopyListMember" Command="Mscrm.CopyListMembers" Sequence="11" Alt="$LocLabels:Ribbon.SubGrid.account.CopyListMember" LabelText="$LocLabels:Ribbon.SubGrid.account.CopyListMember" ModernImage="AddMembers" TemplateAlias="o1" />
                  <Button Id="Mscrm.SubGrid.account.RemoveListMember" ToolTipTitle="$LocLabels:Ribbon.SubGrid.account.RemoveListMember" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.RemoveListMember" Command="Mscrm.RemoveMembers" Sequence="11" Alt="$LocLabels:Ribbon.SubGrid.account.RemoveListMember" LabelText="$LocLabels:Ribbon.SubGrid.account.RemoveListMember" ModernImage="Remove" TemplateAlias="o1" Image16by16="/_imgs/ribbon/Delete_16.png" Image32by32="/_imgs/Workplace/Remove_32.png" />
                  <Button Id="Mscrm.SubGrid.account.AdvMergeRecords" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" ToolTipDescription="$Resources:Ribbon.Tooltip.Merge" Command="Mscrm.HideAdvMergeRecords" Sequence="12" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" Alt="$Resources:Ribbon.HomepageGrid.account.Record.Merge.MergeRecords" Image16by16="/_imgs/ribbon/MergeRecords_16.png" Image32by32="/_imgs/ribbon/MergeRecords_32.png" TemplateAlias="o2" />
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.QuickCampaign" Command="Mscrm.HomepageGrid.QuickCampaign" Sequence="12" Alt="$LocLabels:Ribbon.QuickCampaign.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.LabelText" Image16by16="/_imgs/ribbon/QuickCampaign_16.png" Image32by32="/_imgs/ribbon/QuickCampaign_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.LabelText" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.ToolTip.Description" TemplateAlias="o1" ModernImage="CreateQuickCampaign">
                    <Menu Id="Mscrm.SubGrid.account.QuickCampaign.Menu">
                      <MenuSection Id="Mscrm.SubGrid.account.QuickCampaign.MenuSection" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.SubGrid.account.QuickCampaign.Controls">
                          <Button Id="Mscrm.SubGrid.account.QuickCampaign.Selected" Command="Mscrm.HomepageGrid.ACL.QuickCampaign.Selected" Sequence="10" Alt="$LocLabels:Ribbon.QuickCampaign.Selected.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.Selected.LabelText" Image16by16="/_imgs/ribbon/SelectedRecords_16.png" Image32by32="/_imgs/ribbon/SelectedRecords_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.Selected.ToolTip.Title" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.Selected.ToolTip.Description" ModernImage="MultiSelect" />
                          <Button Id="Mscrm.SubGrid.account.QuickCampaign.AllCurrentPage" Command="Mscrm.HomepageGrid.ACL.QuickCampaign.AllCurrentPage" Sequence="20" Alt="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.LabelText" Image16by16="/_imgs/ribbon/AllRecords_16.png" Image32by32="/_imgs/ribbon/AllRecords_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.ToolTip.Title" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.AllCurrentPage.ToolTip.Description" ModernImage="Letter" />
                          <Button Id="Mscrm.SubGrid.account.QuickCampaign.AllAllPages" Command="Mscrm.HomepageGrid.ACL.QuickCampaign.AllAllPages" Sequence="30" Alt="$LocLabels:Ribbon.QuickCampaign.AllAllPages.LabelText" LabelText="$LocLabels:Ribbon.QuickCampaign.AllAllPages.LabelText" Image16by16="/_imgs/ribbon/AllRecordsAllPages_16.png" Image32by32="/_imgs/ribbon/AllRecordsAllPages_32.png" ToolTipTitle="$LocLabels:Ribbon.QuickCampaign.AllAllPages.ToolTip.Title" ToolTipDescription="$LocLabels:Ribbon.QuickCampaign.AllAllPages.ToolTip.Description" ModernImage="BrowseCards" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                  <Button Id="Mscrm.SubGrid.account.AssociateParentChildCase" ToolTipTitle="$Resources:Ribbon.Form.incident.MainTab.Actions.AssociateParentChildCase" ToolTipDescription="$Resources:Ribbon.Tooltip.AssociateParentChildCase" Command="Mscrm.AssociateParentChildCase" Sequence="13" LabelText="$Resources:Ribbon.Form.incident.MainTab.Actions.AssociateParentChildCase" Alt="$Resources:Ribbon.Form.incident.MainTab.Actions.AssociateParentChildCase" Image16by16="/_imgs/ribbon/AssociateChildCase_16.png" Image32by32="/_imgs/ribbon/AssociateChildCase_32.png" TemplateAlias="o3" />
                  <Button Id="Mscrm.SubGrid.account.MailMerge" ToolTipTitle="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.MailMerge" Command="Mscrm.MailMergeSelected" Sequence="20" Alt="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" LabelText="$Resources:Ribbon.HomepageGrid.account.MainTab.Actions.MailMerge" Image16by16="/_imgs/ribbon/mailmerge16.png" Image32by32="/_imgs/ribbon/mailmerge32.png" TemplateAlias="o2" />
                  <SplitButton Id="Mscrm.SubGrid.account.AddConnection" ToolTipTitle="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" ToolTipDescription="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Tooltip" Command="Mscrm.AddConnectionGrid" Sequence="30" LabelText="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" Alt="$Resources:Ribbon.Connection.Splitbutton.AddConnection.Label" Image16by16="/_imgs/ribbon/AddConnection_16.png" Image32by32="/_imgs/ribbon/AddConnection_32.png" TemplateAlias="o2" ModernImage="Connection">
                    <Menu Id="Mscrm.SubGrid.account.AddConnection.Menu">
                      <MenuSection Id="Mscrm.SubGrid.account.AddConnection.MenuSection" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.SubGrid.account.AddConnection.Controls">
                          <Button Id="Mscrm.SubGrid.account.AddConnectionNew" ToolTipTitle="$Resources:Ribbon.Connection.AddConnectionNew.Label" ToolTipDescription="$Resources:Ribbon.Connection.AddConnectionNew.Tooltip" Command="Mscrm.AddConnectionGrid" Sequence="10" LabelText="$Resources:Ribbon.Connection.AddConnectionNew.Label" Alt="$Resources:Ribbon.Connection.AddConnectionNew.Label" ModernImage="ConnectionToOther" />
                          <Button Id="Mscrm.SubGrid.account.AddConnectionToMe" ToolTipTitle="$Resources:Ribbon.Connection.AddConnectionToMe.Label" ToolTipDescription="$Resources:Ribbon.Connection.AddConnectionToMe.Tooltip" Command="Mscrm.AddConnectionToMeGrid" Sequence="20" LabelText="$Resources:Ribbon.Connection.AddConnectionToMe.Label" Alt="$Resources:Ribbon.Connection.AddConnectionToMe.Label" ModernImage="ConnectionToMe" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </SplitButton>
                  <Button Id="Mscrm.SubGrid.account.AddToQueue" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" ToolTipDescription="$Resources(EntityPluralDisplayName):Mscrm_SubGrid_EntityLogicalName_MainTab_Actions_AddToQueue_ToolTipDescription" Command="Mscrm.AddSelectedToQueue" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.AddToQueue" Image16by16="/_imgs/ribbon/AddToQueue_16.png" Image32by32="/_imgs/ribbon/AddToQueue_32.png" TemplateAlias="o2" ModernImage="AddToQueue" />
                  <Button Id="Mscrm.SubGrid.account.Assign" ToolTipTitle="$Resources(EntityPluralDisplayName):Ribbon.SubGrid.MainTab.Actions.Assign" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Assign" Command="Mscrm.AssignSelectedRecord" Sequence="50" LabelText="$Resources(EntityPluralDisplayName):Ribbon.SubGrid.MainTab.Actions.Assign" Image16by16="/_imgs/ribbon/Assign_16.png" Image32by32="/_imgs/ribbon/Assign_32.png" TemplateAlias="o3" ModernImage="Assign" />
                  <Button Id="Mscrm.SubGrid.account.Sharing" ToolTipTitle="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" ToolTipDescription="$Resources(EntityPluralDisplayName):Ribbon.Tooltip.Share" Command="Mscrm.ShareSelectedRecord" Sequence="60" LabelText="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" Alt="$Resources:Ribbon.HomepageGrid.MainTab.Actions.Sharing" Image16by16="/_imgs/ribbon/Share_16.png" Image32by32="/_imgs/ribbon/Sharing_32.png" TemplateAlias="o4" ModernImage="Share" />
                  <Button Id="Mscrm.SubGrid.account.CopySelected" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" ToolTipDescription="$Resources:Ribbon.Tooltip.CopyShortcut" Command="Mscrm.CopyShortcutSelected" Sequence="70" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" Alt="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Copy" Image16by16="/_imgs/ribbon/copyshortcut16.png" Image32by32="/_imgs/ribbon/copyshortcut32.png" TemplateAlias="o4" />
                  <Button Id="Mscrm.SubGrid.account.SendSelected" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" ToolTipDescription="$Resources:Ribbon.Tooltip.SendShortcut" Command="Mscrm.SendShortcutSelected" Sequence="80" LabelText="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" Alt="$Resources:Ribbon.HomepageGrid.Record.Shortcut.Send" Image16by16="/_imgs/ribbon/EmailLink_16.png" Image32by32="/_imgs/ribbon/SendShortcut_32.png" TemplateAlias="o4" ModernImage="EmailLink" />
                  <Button Id="Mscrm.SubGrid.account.RemoveSelectedRecordsFromEntity" ToolTipTitle="$LocLabels:Ribbon.SubGrid.account.RemoveSelectedRecordsFromEntity" ToolTipDescription="$LocLabels(EntityDisplayName):Ribbon.Tooltip.RemoveSelectedRecordsFromEntity" Command="Mscrm.RemoveSelectedRecordsFromEntity" Sequence="90" Alt="$LocLabels:Ribbon.SubGrid.account.RemoveSelectedRecordsFromEntity" LabelText="$LocLabels:Ribbon.SubGrid.account.RemoveSelectedRecordsFromEntity" ModernImage="Remove" Image16by16="/_imgs/ribbon/Delete_16.png" Image32by32="/_imgs/Workplace/Remove_32.png" TemplateAlias="o2" />
                  <Button Id="Mscrm.SubGrid.account.FollowButton" Command="Mscrm.SubGrid.FollowCommand" ToolTipTitle="$LocLabels:ActivityFeed.Follow.ToolTipTitle" ToolTipDescription="$LocLabels:ActivityFeed.Follow.ToolTipDescription" LabelText="$LocLabels:ActivityFeed.Follow.LabelText" TemplateAlias="o2" Image16by16="/_imgs/ribbon/Entity16_8003.png" Image32by32="/_imgs/ribbon/Entity32_8003.png" Sequence="1010" ModernImage="RatingEmpty" />
                  <Button Id="Mscrm.SubGrid.account.UnfollowButton" Command="Mscrm.SubGrid.UnfollowCommand" ToolTipTitle="$LocLabels:ActivityFeed.Unfollow.ToolTipTitle" ToolTipDescription="$LocLabels:ActivityFeed.Unfollow.ToolTipDescription" LabelText="$LocLabels:ActivityFeed.Unfollow.LabelText" TemplateAlias="o2" Image16by16="/_imgs/ribbon/Entity16_8003_u.png" Image32by32="/_imgs/ribbon/Entity32_8003_u.png" Sequence="1030" ModernImage="RatingFull" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.Filters" Command="Mscrm.FiltersGroup" Sequence="40" Title="$Resources:Ribbon.HomepageGrid.Data.Filters" Image32by32Popup="/_imgs/ribbon/filter32.png" Template="Mscrm.Templates.Flexible2">
                <Controls Id="Mscrm.SubGrid.account.MainTab.Filters.Controls">
                  <ToggleButton Id="Mscrm.SubGrid.account.Filters" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Filters.Filters" ToolTipDescription="$Resources:Ribbon.Tooltip.Filters" Command="Mscrm.Filters" QueryCommand="Mscrm.Filters.Query" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.Filters" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.FiltersToolTip" Image16by16="/_imgs/ribbon/filter16.png" Image32by32="/_imgs/ribbon/filter32.png" TemplateAlias="o1" />
                  <Button Id="Mscrm.SubGrid.account.SaveToCurrent" ToolTipTitle="$Resources:Mscrm_SubGrid_Other_MainTab_Filters_SaveToCurrent_ToolTipTitle" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveFiltersToCurrentView" Command="Mscrm.SaveToCurrentView" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveToCurrent" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveToCurrentToolTip" Image16by16="/_imgs/ribbon/savefilters16.png" Image32by32="/_imgs/ribbon/savefilters32.png" TemplateAlias="o2" />
                  <Button Id="Mscrm.SubGrid.account.SaveAsNew" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsNew" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveFiltersToNewView" Command="Mscrm.SaveAsNewView" Sequence="30" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsNew" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsNewToolTip" Image16by16="/_imgs/ribbon/SaveFilterAsNewView_16.png" Image32by32="/_imgs/ribbon/savefiltersasview32.png" TemplateAlias="o2" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.Layout" Command="Mscrm.Enabled" Sequence="50" Title="$Resources:Ribbon.HomepageGrid.MainTab.ViewGroup" Image32by32Popup="/_imgs/ribbon/ChartsBarGraph_32.png" Template="Mscrm.Templates.Flexible">
                <Controls Id="Mscrm.SubGrid.account.MainTab.Layout.Controls">
                  <Button Id="Mscrm.SubGrid.account.SaveAsDefaultGridView" ToolTipTitle="$Resources:Mscrm_SubGrid_Other_MainTab_Filters_SaveAsDefaultGridView_ToolTipTitle" ToolTipDescription="$Resources:Ribbon.Tooltip.SaveAsDefaultGridView" Command="Mscrm.SaveAsDefaultGridView" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsDefaultGridView" Alt="$Resources:Ribbon.HomepageGrid.Data.Filters.SaveAsDefaultGridViewToolTip" Image16by16="/_imgs/ribbon/SaveViewAsDefault_16.png" Image32by32="/_imgs/ribbon/setasdefaultview32.png" TemplateAlias="o1" />
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.Charts" Command="Mscrm.Charts.Flyout" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts" ToolTipDescription="$Resources:Ribbon.Tooltip.Charts" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts" Alt="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChartsToolTip" Image16by16="/_imgs/ribbon/ChartsBarGraph_16.png" Image32by32="/_imgs/ribbon/ChartsBarGraph_32.png" TemplateAlias="o1">
                    <Menu Id="Mscrm.SubGrid.account.Charts.Menu">
                      <MenuSection Id="Mscrm.SubGrid.account.Charts.MenuSection0" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.SubGrid.account.Charts.Controls0">
                          <ToggleButton Id="Mscrm.SubGrid.account.ChangeLayout.LeftRight" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayout" ToolTipDescription="$Resources:Ribbon.Tooltip.ChangeLayout" Command="Mscrm.Charts" QueryCommand="Mscrm.Charts.Query" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts.LeftRight" Alt="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayoutToolTip" />
                          <ToggleButton Id="Mscrm.SubGrid.account.ChangeLayout.Off" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayout" ToolTipDescription="$Resources:Ribbon.Tooltip.ChangeLayout" Command="Mscrm.Charts.Off" QueryCommand="Mscrm.Charts.Query.Off" Sequence="20" LabelText="$Resources:Ribbon.HomepageGrid.Data.Visuals.Charts.Off" Alt="$Resources:Ribbon.HomepageGrid.Data.Visuals.ChangeLayoutToolTip" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </FlyoutAnchor>
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.Workflow" Command="Mscrm.Enabled" Sequence="70" Title="$Resources:Ribbon.HomepageGrid.Data.Workflow" Image32by32Popup="/_imgs/ribbon/runworkflow32.png" Template="Mscrm.Templates.Flexible">
                <Controls Id="Mscrm.SubGrid.account.MainTab.Workflow.Controls">
                  <Button Id="Mscrm.SubGrid.account.RunWorkflow" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunWorkflow" Command="Mscrm.RunWorkflowSelected" Sequence="30" LabelText="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" Alt="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunWorkflow" Image16by16="/_imgs/ribbon/RunWorkflow_16.png" Image32by32="/_imgs/ribbon/runworkflow32.png" TemplateAlias="o1" />
                  <Button Id="Mscrm.SubGrid.account.RunScript" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunScript" Command="Mscrm.RunInteractiveWorkflowSelected" Sequence="40" LabelText="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" Alt="$Resources:Ribbon.HomepageGrid.Data.InteractiveWorkflow.RunScript" Image16by16="/_imgs/ribbon/StartDialog_16.png" Image32by32="/_imgs/ribbon/StartDialog_32.png" TemplateAlias="o1" />
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.Flows.RefreshCommandBar" Sequence="60" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Workflow.RunFlow" ToolTipDescription="$Resources(EntityDisplayName):Ribbon.Tooltip.RunFlow" Command="Mscrm.Form.Flows.ManageRunFlow" Image16by16="/_imgs/Ribbon/OpenFlows_16.png" Image32by32="/_imgs/Ribbon/OpenFlows_32.png" LabelText="$Resources:RefreshCommandBar.Flows" Alt="$Resources:RefreshCommandBar.Flows" PopulateDynamically="true" PopulateQueryCommand="Mscrm.DynamicMenu.Grid.Flows.PopulateMenu" TemplateAlias="o1" ModernImage="Flows" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.ExportData" Command="Mscrm.Enabled" Sequence="80" Title="$Resources:Ribbon.HomepageGrid.MainTab.ExportData" Image32by32Popup="/_imgs/ribbon/runreport32.png" Template="Mscrm.Templates.Flexible3">
                <Controls Id="Mscrm.SubGrid.account.MainTab.ExportData.Controls">
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.RunReport" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" ToolTipDescription="$Resources:Ribbon.Tooltip.RunReport" Command="Mscrm.ReportMenu.Grid" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.ReportsMenu.Populate.Grid" Sequence="10" LabelText="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" Alt="$Resources:Ribbon.HomepageGrid.Data.Report.RunReport" Image16by16="/_imgs/ribbon/RunReport_16.png" Image32by32="/_imgs/ribbon/runreport32.png" TemplateAlias="o1" ModernImage="Report" />
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.DocumentTemplate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.DocumentTemplate.Templates" ToolTipDescription="$Resources:Ribbon.Tooltip.DocumentTemplate" Command="Mscrm.DocumentTemplate.Templates" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.DocumentTemplate.Populate.Flyout" Sequence="15" LabelText="$Resources:Ribbon.HomepageGrid.Data.DocumentTemplate.Templates" Alt="$Resources:Ribbon.HomepageGrid.Data.DocumentTemplate.Templates" Image16by16="/_imgs/ribbon/DocumentTemplate_16.png" Image32by32="/_imgs/ribbon/SaveAsExcelTemplate_32.png" TemplateAlias="o1" ModernImage="DocumentTemplates" />
                  <FlyoutAnchor Id="Mscrm.SubGrid.account.WordTemplate" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" ToolTipDescription="$Resources:Ribbon.Tooltip.WordTemplate" Command="Mscrm.HomepageGrid.WordTemplate" PopulateDynamically="true" PopulateOnlyOnce="true" PopulateQueryCommand="Mscrm.HomepageGrid.WordTemplate.Populate.Flyout" Sequence="16" LabelText="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" Alt="$Resources:Ribbon.HomepageGrid.Data.WordTemplate.Templates" Image16by16="/_imgs/ribbon/WordTemplate_16.png" Image32by32="/_imgs/ribbon/SaveAsWordTemplate_32.png" TemplateAlias="o1" ModernImage="WordTemplates" />
                  <SplitButton Id="Mscrm.SubGrid.account.ExportToExcel" ToolTipTitle="$Resources(EntityPluralDisplayName):Ribbon.SubGrid.Data.Export.ExportToExcel" ToolTipDescription="$Resources:Ribbon.Tooltip.ExportToExcel" Command="Mscrm.ExportToExcel" Sequence="20" LabelText="$Resources(EntityPluralDisplayName):Ribbon.SubGrid.Data.Export.ExportToExcel" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" TemplateAlias="o3" ModernImage="ExportToExcel">
                    <Menu Id="Mscrm.SubGrid.account.ExportToExcel.Menu">
                      <MenuSection Id="Mscrm.SubGrid.account.ExportToExcel.MenuSection" Sequence="10" DisplayMode="Menu16">
                        <Controls Id="Mscrm.SubGrid.account.ExportToExcel.Controls">
                          <Button Id="Mscrm.SubGrid.account.ExportToExcelOnline" ToolTipTitle="$Resources(EntityPluralDisplayName):Ribbon.SubGrid.Data.Export.ExportToExcelOnline" ToolTipDescription="$Resources:Ribbon.Tooltip.ExportToExcelOnline" Command="Mscrm.ExportToExcel.Online" Sequence="40" LabelText="$Resources(EntityPluralDisplayName):Ribbon.SubGrid.Data.Export.ExportToExcelOnline" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                          <Button Id="Mscrm.HomepageGrid.account.StaticWorksheetAll" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExportAll" ToolTipDescription="$Resources:Ribbon.Tooltip.StaticExcelExportAll" Command="Mscrm.ExportToExcel.AllStaticXlsx" Sequence="41" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExportAll" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExportAll" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                          <Button Id="Mscrm.HomepageGrid.account.StaticWorksheet" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" ToolTipDescription="$Resources:Ribbon.Tooltip.StaticExcelExport" Command="Mscrm.ExportToExcel.StaticXlsx" Sequence="42" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                          <Button Id="Mscrm.HomepageGrid.account.DynamicWorkesheet" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicExcelExport" ToolTipDescription="$Resources:Ribbon.Tooltip.DynamicExcelExport" Command="Mscrm.ExportToExcel.DynamicXlsx" Sequence="43" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicExcelExport" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicExcelExport" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                          <Button Id="Mscrm.HomepageGrid.account.DynamicPivotTable" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicPivotTable" ToolTipDescription="$Resources:Ribbon.Tooltip.DynamicPivotTable" Command="Mscrm.ExportToExcel.PivotXlsx" Sequence="44" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicPivotTable" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.DynamicPivotTable" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" ModernImage="ExportToExcel" />
                        </Controls>
                      </MenuSection>
                    </Menu>
                  </SplitButton>
                  <Button Id="Mscrm.SubGrid.account.ExportSelectedToExcel" ToolTipTitle="$Resources:Ribbon.HomepageGrid.Data.Export.ExportSelectedToExcel" ToolTipDescription="$Resources:Ribbon.Tooltip.ExportSelectedToExcel" Command="Mscrm.ExportSelectedToExcel" Sequence="230" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.ExportSelectedToExcel" Alt="$Resources:Ribbon.HomepageGrid.Data.Export.ExportSelectedToExcel" Image16by16="/_imgs/ribbon/exporttoexcel16.png" Image32by32="/_imgs/ribbon/exporttoexcel32.png" TemplateAlias="o3" ModernImage="ExportToExcel" />
                </Controls>
              </Group>
              <Group Id="Mscrm.SubGrid.account.MainTab.FolderTracking" Command="Mscrm.Enabled" Sequence="80" Title="$Resources:Ribbon.HomepageGrid.FolderTracking" Image32by32Popup="/_imgs/ribbon/runreport32.png" Template="Mscrm.Templates.Flexible3">
                <Controls Id="Mscrm.SubGrid.account.FolderTracking.Controls">
                  <Button Id="Mscrm.SubGrid.account.FolderTracking" Command="Mscrm.HomepageGrid.FolderTracking" Sequence="100" LabelText="$Resources:Ribbon.HomepageGrid.FolderTracking" ToolTipTitle="$Resources:Ribbon.HomepageGrid.FolderTracking" ToolTipDescription="$Resources:Ribbon.HomepageGrid.FolderTracking.TooltipDescription" Image16by16="/_imgs/ribbon/CRM_Activity_Command_FolderTracking_16.png" Image32by32="/_imgs/ribbon/CRM_Activity_Command_FolderTracking_16.png" TemplateAlias="o2" ModernImage="FolderTrack" />
                </Controls>
              </Group>
            </Groups>
          </Tab>
        </ContextualGroup>
      </ContextualTabs>
    </Ribbon>
  </UI>
  <Templates>
    <RibbonTemplates Id="Mscrm.RibbonTemplates">
      <GroupTemplate Id="Mscrm.Templates.3">
        <Layout Title="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="Medium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Small">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.3.3">
        <Layout Title="LargeLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeSmall">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="MediumMedium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="MediumSmall">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="SmallSmall">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMedium" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.3.3.3">
        <Layout Title="LargeLargeMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeMediumLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMediumMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeSmallMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeSmallSmall">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="MediumLargeMedium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="MediumLargeSmall">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMediumMedium" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.4.3.3">
        <Layout Title="LargeMediumLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMediumLarge" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.Activities">
        <Layout Title="MaxSize">
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c1" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c2" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c3" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c4" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c5" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c6" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c7" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c8" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c9" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c10" DisplayMode="Large" />
            </Row>
          </Section>
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="Scale.1">
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c1" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c2" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c3" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c4" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c5" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c6" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c7" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c8" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c9" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c10" DisplayMode="Medium" />
            </Row>
          </Section>
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Scale.2">
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c1" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c2" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c3" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c4" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c5" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c6" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c7" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c8" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c9" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c10" DisplayMode="Small" />
            </Row>
          </Section>
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Scale.3">
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c1" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c2" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c3" DisplayMode="Medium" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c4" DisplayMode="Medium" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c5" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c6" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c7" DisplayMode="Small" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c8" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c9" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c10" DisplayMode="Small" />
            </Row>
          </Section>
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Scale.4">
          <Section Type="OneRow">
            <Row>
              <ControlRef TemplateAlias="c1" DisplayMode="Large" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c2" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c3" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c4" DisplayMode="Small" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c5" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c6" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c7" DisplayMode="Small" />
            </Row>
          </Section>
          <Section Type="ThreeRow">
            <Row>
              <ControlRef TemplateAlias="c8" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c9" DisplayMode="Small" />
            </Row>
            <Row>
              <ControlRef TemplateAlias="c10" DisplayMode="Small" />
            </Row>
          </Section>
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="MaxSize" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.Flexible">
        <Layout Title="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="Medium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Small">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.Flexible2">
        <Layout Title="LargeLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="MediumMedium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="MediumSmall">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeSmall">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMedium" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.Flexible3">
        <Layout Title="LargeLargeMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeMediumLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeSmallLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="MediumMediumLarge">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="MediumSmallLarge">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMediumMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeSmallSmall">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="MediumMediumSmall">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMediumLarge" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.Flexible4">
        <Layout Title="LargeMediumLargeLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o4" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMediumSmallLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o4" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeLargeMediumLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o4" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMediumMediumLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o4" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMediumLargeMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o4" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="LargeSmallLargeSmall">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o4" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMediumLargeMedium" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.FourLargeButtons">
        <Layout Title="Large" LayoutTitle="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="Medium" LayoutTitle="Medium">
          <OverflowSection Type="TwoRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="MediumSmall">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Small">
          <OverflowSection Type="TwoRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.FourOverflow">
        <Layout Title="LargeMediumLargeLarge">
          <OverflowSection Type="OneRow" TemplateAlias="o5" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o6" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o7" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o8" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o4" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="LargeMediumLargeMedium">
          <OverflowSection Type="OneRow" TemplateAlias="o5" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o6" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o7" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o8" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o4" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="LargeMediumLargeMedium" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.OneLargeThreeMedium">
        <Layout Title="Large" LayoutTitle="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Medium" LayoutTitle="Medium">
          <OverflowSection Type="TwoRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="TwoRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.OneLargeTwoMedium">
        <Layout Title="Large" LayoutTitle="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="TwoRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Medium" LayoutTitle="Medium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.ThreeLargeThreeMedium">
        <Layout Title="Large" LayoutTitle="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Medium" LayoutTitle="Medium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.TwoLargeThreeMedium">
        <Layout Title="Large" LayoutTitle="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Medium" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Medium" LayoutTitle="Medium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Large" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="MediumSmall">
          <OverflowSection Type="TwoRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Small">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="OneRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.TwoLargeTwoMedium">
        <Layout Title="Large" LayoutTitle="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="o2" DisplayMode="Large" />
          <OverflowSection Type="TwoRow" TemplateAlias="o3" DisplayMode="Medium" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Medium" LayoutTitle="Medium">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="TwoRow" TemplateAlias="o2" DisplayMode="Small" />
          <OverflowSection Type="TwoRow" TemplateAlias="o3" DisplayMode="Small" />
          <OverflowSection Type="TwoRow" TemplateAlias="isv" DisplayMode="Small" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.Visualization.Charts">
        <Layout Title="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="MediumMedium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="Large" />
      </GroupTemplate>
      <GroupTemplate Id="Mscrm.Templates.VisualizationDesigner.Charts">
        <Layout Title="Large">
          <OverflowSection Type="OneRow" TemplateAlias="o1" DisplayMode="Large" />
          <OverflowSection Type="OneRow" TemplateAlias="isv" DisplayMode="Large" />
        </Layout>
        <Layout Title="MediumMedium">
          <OverflowSection Type="ThreeRow" TemplateAlias="o1" DisplayMode="Medium" />
          <OverflowSection Type="ThreeRow" TemplateAlias="isv" DisplayMode="Medium" />
        </Layout>
        <Layout Title="Popup" LayoutTitle="MediumMedium" />
      </GroupTemplate>
    </RibbonTemplates>
  </Templates>
  <CommandDefinitions>
    <CommandDefinition Id="Mscrm.HomepageGrid.account.MergeRecords">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountOneOrTwo" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="ClientUtility.ClientUtil.ValidateSettingsForModernDevice" />
        <DisplayRule Id="Mscrm.HomepageGrid.account.MergeGroup" />
        <DisplayRule Id="Mscrm.CanWriteAccount" />
        <DisplayRule Id="Mscrm.HybridDialogMergeEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="ClientUtility.ClientUtil.launchUCIMergeDialog" Library="$webresource:CRM/ClientUtility.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddSelectedToMarketingList">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.NotAListForm" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddSelectedToMarketingList" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.CommandActions.Instance.addToList" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="LinkedInExtensions.ViewOrgChartForGrid">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.HideOnMobile" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.IsOrgChartFeatureEnabled" />
        <DisplayRule Id="Mscrm.CanReadContact" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="LinkedInExtensions.Account.Instance.ViewOrgChartFromGrid" Library="$webresource:LinkedInExtensions/Account/LinkedInExtensions_Account.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Enabled">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.WriteSelectedEntityPermission" />
        <DisplayRule Id="FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.Command.DisplayRule.EntityPrivilegeRule" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="GeoCodePopUp.Library.OpenDialog" Library="$webresource:msdyn_/GeoCodeUtils/GeoCodePopUp.Library.js">
          <CrmParameter Value="PrimaryControl" />
          <StringParameter Value="Account" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.{!EntityLogicalName}.MainTab">
      <EnableRules>
        <EnableRule Id="Mscrm.HomepageGrid.{!EntityLogicalName}.MainTab" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.NewRecordFromGrid">
      <EnableRules>
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.IsValidForHierarchyPageInUC" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.PrimaryIsNotActivityHomePageGrid" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CreateSelectedEntityPermission" />
        <DisplayRule Id="Mscrm.ShowForNonRelationshipBoundGrids" />
        <DisplayRule Id="Mscrm.HideNewForChildEntities" />
        <DisplayRule Id="Mscrm.HideAddressEntities" />
        <DisplayRule Id="Mscrm.NotOnMarketingList" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Open.openNewRecord" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.NewRecordForBPFEntity">
      <EnableRules>
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.IsValidForHierarchyPageInUC" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsPUV2EntityCustomizationEnabled" />
        <DisplayRule Id="Mscrm.IsBPFEntityCustomizationFeatureEnabled" />
        <DisplayRule Id="Mscrm.SelectedEntityIsBPFEntity" />
        <DisplayRule Id="Mscrm.CreateSelectedEntityPermission" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.NewRecordForBPFEntity.openNewRecord" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.EditSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.CheckBulkEditSupportForEntity" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.BulkEditPrivilege" />
        <DisplayRule Id="Mscrm.WriteSelectedEntityPermission" />
        <DisplayRule Id="Mscrm.HybridDialogBulkEditEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.BulkEdit.bulkEditRecords" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.Activate">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWriteSelected" />
        <DisplayRule Id="Mscrm.SelectedEntityHasStatecode" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Activate.activateRecords" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.Deactivate">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWriteSelected" />
        <DisplayRule Id="Mscrm.SelectedEntityHasStatecode" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Deactivate.deactivateRecords" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.OpenActiveStage">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsPUV2EntityCustomizationEnabled" />
        <DisplayRule Id="Mscrm.IsBPFEntityCustomizationFeatureEnabled" />
        <DisplayRule Id="Mscrm.SelectedEntityIsBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.OpenActiveStage.openActiveStageFromGrid" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.DeleteSplitButtonCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.DeleteSplitButtonEnableRule" />
        <EnableRule Id="Mscrm.AnySelection" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.DeleteSplitButtonDisplayRule" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Delete.deleteRecords" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DeleteSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotShowForManyToManyGrids" />
        <DisplayRule Id="Mscrm.DeleteSelectedEntityPermission" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.deleteRecords" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.BulkDelete">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.GridFiltersEnabled" />
        <DisplayRule Id="Mscrm.BulkDelete" />
        <DisplayRule Id="Mscrm.DeletePrimaryEntityPermission" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.bulkDelete" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.DetectDupes">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.DuplicateDetectionEnabled" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.DetectDupesSelected">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.detectDuplicatesSelectedRecords" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.DetectDupesAll">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.detectDuplicatesAllRecords" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControlAllItemCount" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ChangeControlCommand">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsDataSetControlEnabled" />
        <DisplayRule Id="Mscrm.WebClient" />
        <DisplayRule Id="Mscrm.NotOffline" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.ChangeControlCommand">
      <EnableRules />
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Modern.refreshCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.FormStateNotNew" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Refresh.refreshCommand" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.NavigateToHomepageGrid">
      <EnableRules>
        <EnableRule Id="Mscrm.ShowOnDashboardPageUCI" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.IsNavigateToInUCIEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.NavigateToGrid.navigateToHomepageGrid" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddEmailToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.WriteActivityPermission" />
        <DisplayRule Id="Mscrm.SelectedEntityIsListedForSendDirectEmailOrEmailable" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.sendBulkEmail" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControlAllItemCount" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AssignSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.IsValidForHierarchyPageInUC" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AssignSelectedEntityPermission" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Assign.assignSelectedRecords" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ShareSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.ShareValid" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShareSelectedEntityPermission" />
        <DisplayRule Id="Mscrm.HybridDialogShareEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Share.shareSelectedRecords" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ViewHierarchyForSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.IsRecordHierarchyEnabled" />
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Hierarchy.ViewHierarchyFromGrid" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CopyShortcutSelected.EnabledInIEBrowser">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableInIEBrowser" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.Utilities.sendSelectedRecordsUrl" Library="/_common/global.ashx">
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CopyShortcutSelected">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.EnableInIEBrowser" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.Utilities.sendSelectedRecordsUrl" Library="/_common/global.ashx">
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CopyShortcutView">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.EmailCopyLink.sendCurrentViewUrl" Library="$webresource:Main_system_library.js">
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SendShortcutSelected.AlwaysEnabled">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.IsValidForHierarchyPageInUC" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.EmailCopyLink.emailCopyLinkRecords" Library="$webresource:Main_system_library.js">
          <BoolParameter Value="true" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SendShortcutSelected">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.IsValidForHierarchyPageInUC" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.EmailCopyLink.emailCopyLinkRecords" Library="$webresource:Main_system_library.js">
          <BoolParameter Value="true" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SendShortcutView">
      <EnableRules>
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.EmailCopyLink.sendCurrentViewUrl" Library="$webresource:Main_system_library.js">
          <BoolParameter Value="true" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddConnectionGrid">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CreateConnection" />
        <DisplayRule Id="Mscrm.IsConnectionsEnabledSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.addConnection" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <BoolParameter Value="false" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddConnectionToMeGrid">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CreateConnection" />
        <DisplayRule Id="Mscrm.IsConnectionsEnabledSelected" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.addConnection" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <BoolParameter Value="true" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddSelectedToQueue">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AppendToSelected" />
        <DisplayRule Id="Mscrm.WorksWithQueueSelected" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="AppCommon.Commands.Queue.AddGridRecordsToQueue" Library="$webresource:AppCommon/Commands/QueueCommands.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RunWorkflowSelected">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.RunWorkflowSelected" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.launchOnDemandWorkflow" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
          <StringParameter Value="" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RunInteractiveWorkflowSelected">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.RunWorkflowSelected" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.runScript" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Flows.ManageRunFlow">
      <EnableRules>
        <EnableRule Id="Mscrm.IsMicrosoftFlowIntegrationEnabled" />
        <EnableRule Id="Mscrm.DisplayFlowSingleMenu" />
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.MicrosoftFlows" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Grid.Flows.PopulateMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Flows">
      <EnableRules>
        <EnableRule Id="Mscrm.IsMicrosoftFlowIntegrationEnabled" />
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.MicrosoftFlows" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.IsFlowSubMenuUCIEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Grid.Flows.PopulateStaticFlowMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateStaticFlowMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="false" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Grid.Flows.PopulateFlowMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateFlowMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Flows.RunWorkflow">
      <EnableRules>
        <EnableRule Id="Mscrm.IsMicrosoftFlowIntegrationEnabled" />
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.MicrosoftFlows" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.IsOnDemandWorkflowUCIEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Grid.Flows.PopulateWorkFlowMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateWorkFlowMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <BoolParameter Value="false" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ReportMenu.Grid">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed" />
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ReadReport" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.HybridDialogReportsEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ReportsMenu.Populate.Grid">
      <EnableRules>
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.RunReport.generateReportMenuXml" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DocumentTemplate.Templates">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.ExportToExcel.ValidForXlsxExport" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.DocumentGenerationPrivilege" />
        <DisplayRule Id="Mscrm.TemplatesFCBEnabled" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DocumentTemplate.Populate.Flyout">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.generateExcelTemplateFlyout" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.WordTemplate">
      <EnableRules>
        <EnableRule Id="Mscrm.IsFolderNotSelected" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.DocumentGenerationPrivilege" />
        <DisplayRule Id="Mscrm.WordTemplatesFCBEnabled" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.WordTemplate.Populate.Flyout">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.generateWordTemplateFlyout" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="false" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportToExcel">
      <EnableRules>
        <EnableRule Id="Mscrm.ExportToExcel" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountNoneOrOutlook" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ExportToExcelPrivilege" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="5" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportToExcel.Online">
      <EnableRules>
        <EnableRule Id="Mscrm.ExportToExcel.ValidForXlsxExport" />
        <EnableRule Id="Mscrm.EnableExportToExcelOnlineForModern" />
        <EnableRule Id="Mscrm.EnableOnlyInBrowsersForModern" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.Live" />
        <DisplayRule Id="Mscrm.IsExportToExcelFCBEnabled" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.NotAdvancedFind" />
        <DisplayRule Id="Mscrm.HideOnPhoneForNonModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="6" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportToExcel.AllStaticXlsx">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsExportToExcelFCBEnabled" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="5" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportToExcel.StaticXlsx">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsExportToExcelFCBEnabled" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="4" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportToExcel.DynamicXlsx">
      <EnableRules>
        <EnableRule Id="Mscrm.ExportToExcel.ValidForXlsxExport" />
        <EnableRule Id="Mscrm.EnableOnlyInBrowsersForModern" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsExportToExcelFCBEnabled" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="2" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportToExcel.PivotXlsx">
      <EnableRules>
        <EnableRule Id="Mscrm.ExportToExcel.ValidForXlsxExport" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowPivotXlsx" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="3" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportSelectedToExcel">
      <EnableRules>
        <EnableRule Id="Mscrm.ExportToExcel" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ExportToExcelPrivilege" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.ShowExportSelectedToExcel" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.exportToExcel" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <IntParameter Value="5" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ImportDataFromExcel">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableImportForWeb" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ImportData" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.SelectedEntityIsNotBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Import.importFromExcel" Library="$Webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ImportDataFromCSV">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableImportForWeb" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.SelectedEntityIsNotBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Import.importFromCSV" Library="$Webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ImportDataSplitButton">
      <EnableRules>
        <EnableRule Id="Mscrm.IsNotIos" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.ImportData" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.SelectedEntityIsNotBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.ImportData_0" Library="$Webresource:Ribbon_main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ImportData">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
        <!--<EnableRule Id="MsUSD.HideCommandBarOnUSDSettingsPage" />-->
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.ImportData" />
        <DisplayRule Id="Mscrm.HideOnSettingsCommandBarPage" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.ImportData_0" Library="$Webresource:Ribbon_main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ExportDataTemplate">
      <EnableRules>
        <EnableRule Id="Mscrm.CanExportDataTemplate" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.ExportDataTemplate_0" Library="$Webresource:Ribbon_main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Filters">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableFiltersButton" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.GridFiltersEnabled" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.gridFiltersToggle" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Filters.Query">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.gridFiltersQuery" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.OpenGridAdvancedFind">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.OutlookClient" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.openAdvancedFind" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.OpenMultipleEntityQuickFindSearch">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookClient" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.openMultipleEntityQuickFindSearch" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.OutlookHelp">
      <EnableRules>
        <EnableRule Id="Mscrm.ShowOnlyInOutlookExplorerOrInspector" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookClient" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="AIBuilder.Command.Flyout">
      <EnableRules>
        <EnableRule Id="AIBuilder.IsPAIEnabled" />
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="AIBuilder.FCB.ShowAIBuilderCommandInUCI" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="AIBuilder.Command.PopulateFlyoutMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="AIBuilder.Commands.PopulateFlyoutMenu" Library="$webresource:msdyn_AIBuilder.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Disabled">
      <EnableRules>
        <EnableRule Id="Mscrm.Disabled" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="AIBuilder.Command.CreateModel">
      <EnableRules>
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="AIBuilder.Commands.CreateModel" Library="$webresource:msdyn_AIBuilder.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="AIBuilder.Command.SeeModels">
      <EnableRules>
        <EnableRule Id="Mscrm.AnySelection" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="AIBuilder.Commands.SeeModels" Library="$webresource:msdyn_AIBuilder.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ImportDataFromXML">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableImportForWeb" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.SelectedEntityIsNotBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="importFromXML" Library="$webresource:AppCommon/ImportExport/ImportExport_main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.modern.AddEmailToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsBulkEmailInUciEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.WriteActivityPermission" />
        <DisplayRule Id="Mscrm.SelectedEntityIsListedForSendDirectEmailOrEmailable" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Activities.BulkEmailDialog.openBulkEmailDialog" Library="$webresource:Activities/SystemLibraries/InsertEmailTemplate.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControlAllItemCount" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Playbook.HomepageGrid.Launch">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.IsPlaybookTemplateAvailableFromGrid" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.CanLaunchPlaybook" />
        <DisplayRule Id="Mscrm.IsPlaybookFeatureEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="PlaybookService.GridCommandBarActions.LaunchPlaybook" Library="$webresource:Playbook/CommandBarActions/Playbook_CommandBarActions_library.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.FollowCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="msdyn.ActivityFeeds.IsEntityWallEnabledActive" />
        <EnableRule Id="msdyn.ActivityFeeds.Yammer.ShouldEnableFollow" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="msdyn.ActivityFeeds.IsMultiRecordFollowAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="msdyn.ActivityFeeds.ShowFollowButton" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.followFromGrid">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.UnfollowCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="msdyn.ActivityFeeds.IsEntityWallEnabledInActive" />
        <EnableRule Id="Mscrm.IsValidForHierarchyView" />
        <EnableRule Id="msdyn.ActivityFeeds.IsMultiRecordFollowAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="msdyn.ActivityFeeds.ShowUnfollowButton" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.unfollowFromGrid">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="loadGuidedHelp">
      <EnableRules>
        <EnableRule Id="IsGuidedHelpEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="GuidedHelpDisplayRule" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="checkForGuidedHelp" Library="$webresource:msdyn_LoadGuidedHelpMoCA.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="launchLPLibrary">
      <EnableRules>
        <EnableRule Id="IsGuidedHelpEnabled" />
        <EnableRule Id="LPLibraryEnabled" />
        <EnableRule Id="IsNotISH" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="GuidedHelpDisplayRule" />
        <DisplayRule Id="LPPrivilegeRule" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="launchLPLibrary" Library="$webresource:msdyn_LoadGuidedHelpMoCA.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomePageGrid.MSTeamsViewCollaborateCommand">
      <EnableRules>
        <EnableRule Id="OfficeProductivity.RibbonRules.showMSTeamsViewCollaborateCommand" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.IsMSTeamsIntegrationEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="OfficeProductivity.RibbonCommands.showMSTeamsViewCollaborateDialog" Library="$webresource:msdyn_/OfficeProductivity_RibbonCommands.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="msdyn.ApplicationRibbon.HomeGrid.BookResource.Command">
      <EnableRules>
        <EnableRule Id="msdyn.ApplicationRibbon.HomeGrid.BookResource.EnableRule" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:msdyn_/fps/LocalizationLibrary/Localization.Library.js" />
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:msdyn_/fps/Utils/FpsUtils.js" />
        <JavaScriptFunction FunctionName="FpsUtils.Form.bookButtonAction" Library="$webresource:msdyn_/fps/Utils/FpsUtils.js">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstSelectedItemId" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="msdyn.ApplicationRibbon.HomeGrid.RunRoutingRule.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.IsRoutingRuleCreatedForEntity" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.EntityIsNotIncident" />
        <DisplayRule Id="Mscrm.IsAnyEntityRoutingRuleEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="AnyEntityRoutingRule.CommandBarActions.Instance.runRoutingRuleGrid" Library="$webresource:msdyn_/AnyEntityRoutingRule/CommandBarActions/AnyEntityRoutingRuleCommandBarActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Entity.btnAddtoconfiguration.Command">
      <EnableRules>
        <EnableRule Id="MsUSD.HideAddtoConfigurationButton" />
        <!--<EnableRule Id="MsUSD.HideCommandBarOnUSDSettingsPage" />-->
        <EnableRule Id="MsUSD.SelectionCountMinimumOne" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <!--Sdk.SoapHelper.js file needs to load first-->
        <JavaScriptFunction Library="$Webresource:msdyusd_/Scripts/Sdk.SoapHelper.js" FunctionName="isNaN" />
        <JavaScriptFunction Library="$Webresource:msdyusd_/Scripts/Sdk.ExecuteMultiple.js" FunctionName="isNaN" />
        <JavaScriptFunction Library="$Webresource:msdyusd_/Scripts/Sdk.Associate.js" FunctionName="isNaN" />
        <JavaScriptFunction Library="$Webresource:UII_XrmUtility.js" FunctionName="isNaN" />
        <JavaScriptFunction Library="$Webresource:msdyusd_/Scripts/USD_main_system_library.js" FunctionName="USD.CrmAddtoConfiguration">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.Cadence.Apply">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.HideOnMobile" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.IsEntityApplicableForCadence" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsSalesAccFeatureEnabled" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.DoesUserHaveSequencePrivileges" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Sales.SalesCadence.Instance.ApplyCadence" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.Sequence.Disconnect">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.HideOnMobile" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.Sequence.Grid.IsApplicableForDisconnect" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsSalesAccFeatureEnabled" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.DoesUserHaveSequencePrivileges" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Sales.SalesCadence.Instance.DisconnectSequenceFromGrid" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.MainTab.QuickPowerBI.Command">
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.HideOnPhone" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
      </DisplayRules>
      <EnableRules>
        <EnableRule Id="Mscrm.EnablePowerBIQuickReport" />
      </EnableRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.PowerBI.openPowerBiQuickReport" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.{!EntityLogicalName}.MainTab">
      <EnableRules>
        <EnableRule Id="Mscrm.HomepageGrid.{!EntityLogicalName}.MainTab" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Ribbon.TabSwitch">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.onTabSwitch" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Ribbon.RootEvent">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.onRootEvent" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.FiltersGroup">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.GridFiltersEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SaveAsDefaultGridView">
      <EnableRules>
        <EnableRule Id="Mscrm.SetDefaultGridViewButtonEnabled" />
        <EnableRule Id="Mscrm.EnableOnHomePageAspx" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotAdvancedFind" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.saveAsDefaultGridView" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CustomizePreviewPane">
      <EnableRules>
        <EnableRule Id="Mscrm.ShowOnlyInOutlookExplorerOrInspector" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookClient" />
        <DisplayRule Id="Mscrm.OutlookClientNotVersion11" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SaveToCurrentView">
      <EnableRules>
        <EnableRule Id="Mscrm.UserQuerySelected" />
        <EnableRule Id="Mscrm.EnableSaveButton" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.GridFiltersEnabled" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.gridFiltersSaveToCurrentView" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SaveAsNewView">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableSaveButton" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.GridFiltersEnabled" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.gridFiltersSaveAsNewView" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.NewPersonalView">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.userquery.Create" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.createPersonalView" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RefreshGrid">
      <EnableRules>
        <EnableRule Id="Mscrm.ShowOnlyInOutlookExplorerOrInspector" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.refreshGrid" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Chart">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsEntityEnabledForCharts" />
        <DisplayRule Id="Mscrm.DisplayCharts" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.Flyout">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableChartsButton" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsEntityEnabledForCharts" />
        <DisplayRule Id="Mscrm.NotAdvancedFind" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ChartsLayout.LeftRight">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableChartsButton" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.changeCompositeControlLayout" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControl" />
          <IntParameter Value="0" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.Layout.Query.LeftRight">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.showChartLayoutQuery" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedControl" />
          <StringParameter Value="0" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ChartsLayout.Top">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableChartsButton" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.changeCompositeControlLayout" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControl" />
          <IntParameter Value="1" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.Layout.Query.Top">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.showChartLayoutQuery" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedControl" />
          <StringParameter Value="1" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.HomePage.Off">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableChartsButton" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.hideVisualization" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.Query.Off">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.visualizationOffQuery" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.NewChart">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.IsFetchxmlQuery" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Create" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.userqueryvisualization.Read" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.createNewVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.EditChart">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.IsChartSelected" />
        <EnableRule Id="Mscrm.UserVisualizationSelected" />
        <EnableRule Id="Mscrm.IsParentChartLoaded" />
        <EnableRule Id="Mscrm.IsFetchxmlQuery" />
        <EnableRule Id="Mscrm.IsDefaultVisualizationModule" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Write" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.editVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.ExpandChart">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.WebClient" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.expandVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.CopyChart">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableSaveAsChart" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Create" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.userqueryvisualization.Read" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.copyVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.ImportChart">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Create" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.userqueryvisualization.Read" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.importVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.ExportChart">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.IsChartSelected" />
        <EnableRule Id="Mscrm.IsParentChartLoaded" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.exportVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DeleteChart">
      <EnableRules>
        <EnableRule Id="Mscrm.IsDeleteVisualizationEnabled" />
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.EnableOnHomePageAspxOrOutlook" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Delete" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.deleteVisualization" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.RefreshChart">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.IsChartSelected" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.refreshVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.AssignVisualization">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableAssignShareChartButton" />
        <EnableRule Id="Mscrm.IsParentChartLoaded" />
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Assign" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.assignVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.ShareVisualization">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableAssignShareChartButton" />
        <EnableRule Id="Mscrm.IsParentChartLoaded" />
        <EnableRule Id="Mscrm.VisualizationPaneRuntimeOrEditMode" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.Share" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.shareVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Chart">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsEntityEnabledForCharts" />
        <DisplayRule Id="Mscrm.DisplayCharts" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.account.QuickCampaign">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.QuickCampaign" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.ACL.QuickCampaign.Selected">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.QuickCampaignAllowed" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.CommandActions.Instance.quickCampaignSelectedItems" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.ACL.QuickCampaign.AllCurrentPage">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastZero" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.QuickCampaignAllowed" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.CommandActions.Instance.quickCampaignCurrentPage" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlAllItemIds" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.ACL.QuickCampaign.AllAllPages">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastZero" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.QuickCampaignAllowed" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.CommandActions.Instance.quickCampaignAllPages" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.QuickCampaign">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.QuickCampaignAllowed" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.account.Relationship">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.account.Relationship.Opportunity">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship" />
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship.Opportunity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.addCustomerOpportunityRole" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.account.Relationship.Customer">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship" />
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship.Customer" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.addCustomerRelationship" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddFileToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsNotIos" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AppendToSelected" />
        <DisplayRule Id="Mscrm.CreateAndAppendNote" />
        <DisplayRule Id="Mscrm.SelectedEntityHasNotes" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addFileToRecord" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="FirstSelectedItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddNoteToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AppendToSelected" />
        <DisplayRule Id="Mscrm.CreateAndAppendNote" />
        <DisplayRule Id="Mscrm.SelectedEntityHasNotes" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addNoteToRecord" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="FirstSelectedItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddTaskToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="task" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SendEmailToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="email" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddPhoneToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="phonecall" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddLetterToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="letter" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddFaxToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="fax" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddAppointmentToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="appointment" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddRecurringAppointmentToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <StringParameter Value="recurringappointmentmaster" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddServiceActivityToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.CreateServiceAppointment" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <IntParameter Value="4214" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Grid.AddCustomActivity">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Grid.AddActivity">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.MailMergeSelected">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.IsNotIos" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.MailMergeSelected" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridRibbonActions.webMailMerge" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="SelectedControlAllItemCount" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddCampaignResponseToSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToSelected" />
        <DisplayRule Id="Mscrm.CreateCampaignResponse" />
        <DisplayRule Id="Mscrm.SelectedEntityHasCampaignResponse" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityFromGrid" Library="$webresource:Main_system_library.js">
          <IntParameter Value="4401" />
          <StringParameter Value="" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Developer">
      <EnableRules>
        <EnableRule Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Developer" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DesignView">
      <EnableRules>
        <EnableRule Id="Mscrm.IsSystemViewLoaded" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.savedquery.Update" />
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
        <DisplayRule Id="Mscrm.IsCustomizable" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.designView" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CreateView">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.savedquery.Create" />
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
        <DisplayRule Id="Mscrm.IsCustomizable" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.createSystemView" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CustomizeEntity">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.ShowOnGridAndLegacy" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.openEntityEditor" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ManageViews">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.savedquery.Read" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.manageViews" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SaveFilterForSystemQuery">
      <EnableRules>
        <EnableRule Id="Mscrm.SystemQuerySelected" />
        <EnableRule Id="Mscrm.EnableSaveButton" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.GridFiltersEnabled" />
        <DisplayRule Id="Mscrm.savedquery.Update" />
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.IsCustomizable" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.gridFiltersSaveToCurrentView" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.PublishEntity">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.FormEditor.PublishEntity" Library="/_common/global.ashx">
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.PublishAll">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.FormEditor.PublishAll" Library="/_common/global.ashx" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Developer">
      <EnableRules>
        <EnableRule Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Developer" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.ShowVisualizationToolsRibbon" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.ShowInHomePageGrid" />
        <DisplayRule Id="Mscrm.ShowOnHomePageAspxOrOutlook" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.SaveChart">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableSaveChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.CreateOrWrite" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.saveVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.SaveAndCloseChart">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableSaveChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.userqueryvisualization.CreateOrWrite" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.saveAndCloseVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.ChartsGroup">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneDesignerMode" />
        <EnableRule Id="Mscrm.NotComplexChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.ColumnFlyout">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.Visualization.CanApplyColumnChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.Column">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Column" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.StackedColumn">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="StackedColumn" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.StackedColumn100">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="StackedColumn100" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.BarFlyout">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.Visualization.CanApplyBarChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.Bar">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Bar" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.StackedBar">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="StackedBar" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.StackedBar100">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="StackedBar100" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.AreaFlyout">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.Visualization.CanApplyAreaChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.Area">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Area" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.StackedArea">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="StackedArea" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.Charts.StackedArea100">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="StackedArea100" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.LineChart">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.Visualization.CanApplyLineChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Line" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.PieChart">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.Visualization.CanApplyPieChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Pie" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.FunnelChart">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.Visualization.CanApplyFunnelChart" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Funnel" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopFlyout">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.TopBottomEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.Top3">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyTopBottom" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="true" />
          <IntParameter Value="3" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.Top5">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyTopBottom" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="true" />
          <IntParameter Value="5" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.TopX">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyTopBottomCustom" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="true" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.BottomFlyout">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.TopBottomEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.Bottom3">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyTopBottom" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="false" />
          <IntParameter Value="3" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.Bottom5">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyTopBottom" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="false" />
          <IntParameter Value="5" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.BottomX">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.applyTopBottomCustom" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="false" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationDesignerTab.TopBottom.Clear">
      <EnableRules>
        <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule" />
        <EnableRule Id="Mscrm.TopBottomEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.clearTopBottom" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTab.CloseDesigner">
      <EnableRules>
        <EnableRule Id="Mscrm.VisualizationPaneDesignerMode" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.closeDesigner" Library="/_static/_common/scripts/RibbonActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.VisualizationTools.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.ShowVisualizationToolsRibbon" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.ShowInHomePageGrid" />
        <DisplayRule Id="Mscrm.ShowOnHomePageAspxOrOutlook" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ACL.RemoveSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowForManyToManyGrids" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Disassociate.gridDisassociate" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="FirstSelectedItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddMembers">
      <EnableRules>
        <EnableRule Id="Mscrm.IsListStatic" />
        <EnableRule Id="Mscrm.IsListUnLocked" />
        <EnableRule Id="Mscrm.SubGrid.EnableRule.SubgridEntityMatchesTarget" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.EntityFormIsEnabled" />
        <EnableRule Id="Mscrm.IsUci" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.AddExisting" />
        <DisplayRule Id="Mscrm.ShowForManyToManyGrids" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.AppendSelected" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.List.CommandActions.addMembers" Library="$webresource:Marketing/List/List_main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RemoveMembers">
      <EnableRules>
        <EnableRule Id="Mscrm.IsListForm" />
        <EnableRule Id="Mscrm.IsUci" />
        <EnableRule Id="Mscrm.IsListUnLocked" />
        <EnableRule Id="Mscrm.IsListStatic" />
        <EnableRule Id="Mscrm.EntityFormIsEnabled" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnQCEntityForm" />
        <DisplayRule Id="Mscrm.HideOnCAEntityForm" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.List.CommandActions.removeMembers" Library="$webresource:Marketing/List/List_main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemIds" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RemoveSelectedRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowForManyToManyGrids" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.HideOnUciList" />
        <DisplayRule Id="Mscrm.HideOnQCEntityForm" />
        <DisplayRule Id="Mscrm.HideOnCAEntityForm" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.List.CommandActions.gridDisassociateListMember" Library="$webresource:Marketing/List/List_main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="FirstSelectedItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CopyListMembers">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.IsListForm" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.List.CommandActions.copyListMembers" Library="$webresource:Marketing/List/List_main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RemoveSelectedRecordsFromEntity">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideOnListEntityForm" />
        <DisplayRule Id="Mscrm.HideOnQCEntityForm" />
        <DisplayRule Id="Mscrm.HideOnCAEntityForm" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.Campaign.Instance.diassociateCampaignFromSubGrid" Library="$webresource:Marketing/Campaign/Campaign_main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="FirstSelectedItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CreateOpportunityForMembers">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.AccountOrContactMemberType" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CreateOpportunity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.List.CommandActions.createOpportunityForMembers" Library="$webresource:Marketing/List/List_main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SubGrid.{!EntityLogicalName}.MainTab">
      <EnableRules>
        <EnableRule Id="Mscrm.SubGrid.{!EntityLogicalName}.MainTab" />
        <EnableRule Id="Mscrm.EnableRibbonOnSubGrid" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.OpenAssociatedGridViewOnLiteGridStandard">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowInSubGridStandard" />
        <DisplayRule Id="Mscrm.HideInLegacyRibbon" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.openAssociatedGridViewOnLiteGridStandard" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddNewRecordFromSubGridStandard">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.EntityFormIsEnabled" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowForOneToManyGrids" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.CreateSelectedEntityPermission" />
        <DisplayRule Id="Mscrm.AppendSelected" />
        <DisplayRule Id="Mscrm.HideAddNewForChildEntities" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Open.addNewFromSubGridStandard" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddExistingRecordFromSubGridStandard">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.EntityFormIsEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddExisting" />
        <DisplayRule Id="Mscrm.ShowForOneToManyForAllAndNonRelationshipBoundForMarketingListGrids" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.AppendSelected" />
        <DisplayRule Id="Mscrm.CanWriteSelected" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.AddFromSubGrid.addExistingFromSubGridStandard" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddExistingRecordFromSubGridAssociated">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.EntityFormIsEnabled" />
        <EnableRule Id="Mscrm.isNotDynamicList" />
        <EnableRule Id="Mscrm.IsListUnLocked" />
        <EnableRule Id="Mscrm.SubGrid.EnableRule.SubgridEntityMatchesTargetWebClientOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddExisting" />
        <DisplayRule Id="Mscrm.ShowOnManyToManyExceptCAForm" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.AppendSelected" />
        <DisplayRule Id="Mscrm.HideOnUciList" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.AddFromSubGrid.addExistingFromSubGridAssociated" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HideAdvMergeRecords">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideInLegacyRibbon" />
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AssociateParentChildCase">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastTwo" />
        <EnableRule Id="Mscrm.VisualizationPaneNotMaximized" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.WriteIncident" />
        <DisplayRule Id="Mscrm.WorksWithMergeAndParentChild" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="CrmService.IncidentRibbon.GridCommandActions.associateChildCase" Library="$webresource:Service/Incident/Ribbon/Incident_ribbon_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableChartsButton" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.showVisualization" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.Query">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.showVisualizationQuery" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Charts.Off">
      <EnableRules>
        <EnableRule Id="Mscrm.EnableChartsButton" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.hideVisualization" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.HomepageGrid.FolderTracking">
      <EnableRules />
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.SelectedEntityIsActivity" />
        <DisplayRule Id="Mscrm.NotAdvancedFind" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.GridCommandActions.trackEmailsByFolder" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SubGrid.{!EntityLogicalName}.ContextualTabs">
      <EnableRules>
        <EnableRule Id="Mscrm.SubGrid.{!EntityLogicalName}.ContextualTabs" />
        <EnableRule Id="Mscrm.EnableRibbonOnSubGrid" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SubGrid.FollowCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="msdyn.ActivityFeeds.IsEntityWallEnabledActive" />
        <EnableRule Id="msdyn.ActivityFeeds.IsMultiRecordFollowAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="msdyn.ActivityFeeds.ShowFollowButton" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.followFromGrid">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SubGrid.UnfollowCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountAtLeastOne" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="msdyn.ActivityFeeds.IsEntityWallEnabledInActive" />
        <EnableRule Id="msdyn.ActivityFeeds.IsMultiRecordFollowAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="msdyn.ActivityFeeds.ShowUnfollowButton" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.unfollowFromGrid">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="MailApp.Subgrid.SetRegardingCommand">
      <EnableRules>
        <EnableRule Id="MailApp.Rules.SelectionCountExactlyOne" />
        <EnableRule Id="MailApp.Rules.HasTrackAction" />
        <EnableRule Id="MailApp.Rules.HasTrackStatusProperty" />
        <EnableRule Id="MailApp.Rules.IsNotSetRegardingSelectedRecord" />
        <EnableRule Id="MailApp.Rules.IsTrackAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="MailApp.Rules.HasActivities.Subgrid" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="MailApp.TrackRegardingSelectedRecord" Library="$webresource:new_MailAppScriptResource">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SubGrid.{!EntityLogicalName}.MainTab">
      <EnableRules>
        <EnableRule Id="Mscrm.SubGrid.{!EntityLogicalName}.MainTab" />
        <EnableRule Id="Mscrm.EnableRibbonOnSubGrid" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SubGrid.{!EntityLogicalName}.ContextualTabs">
      <EnableRules>
        <EnableRule Id="Mscrm.SubGrid.{!EntityLogicalName}.ContextualTabs" />
        <EnableRule Id="Mscrm.EnableRibbonOnSubGrid" />
      </EnableRules>
      <DisplayRules />
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AssignPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.AssignPrimaryPermission" />
        <EnableRule Id="Mscrm.NotOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AssignPrimaryPermission" />
        <DisplayRule Id="Mscrm.NotClosedActivity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Assign.assignObject" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SendShortcutPrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.EmailCopyLink.emailCopyLinkPrimaryRecord" Library="$webresource:Main_system_library.js">
          <BoolParameter Value="true" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DeletePrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.CanDeletePrimary" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.DeletePrimaryEntityPermission" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Delete.deletePrimaryRecord" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.FormDesign.OpenFromForm">
      <EnableRules>
        <EnableRule Id="Mscrm.FormDesignValid" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.WriteCustomization" />
        <DisplayRule Id="Mscrm.IsCustomizable" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.OpenFormEditor" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <StringParameter Value="main" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Process">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.IsBPFCommandsAvaialableOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.IsBusinessProcessEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SwitchProcess">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.CanSwitchProcess" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.IsBPFCommandsAvaialableOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.IsBusinessProcessEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.WorkflowWebResource.SwitchProcess" Library="$Webresource:Main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.EditSalesProcess">
      <EnableRules>
        <EnableRule Id="Mscrm.CanEditProcess" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsBusinessProcessEnabled" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.CanActivateBusinessProcessFlows" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.editSalesProcess" Library="/_static/_common/scripts/CommandBarActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Abandon">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.IsBusinessProcessPresent" />
        <EnableRule Id="Mscrm.ShowAbandon" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.IsBPFCommandsAvaialableOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.IsBusinessProcessEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.WorkflowWebResource.AbandonProcess" Library="$Webresource:Main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Reactivate">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.IsBusinessProcessPresent" />
        <EnableRule Id="Mscrm.ShowReactivate" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.IsBPFCommandsAvaialableOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.IsBusinessProcessEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.WorkflowWebResource.ReactivateProcess" Library="$Webresource:Main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.FinishStage">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.IsBusinessProcessPresent" />
        <EnableRule Id="Mscrm.ShowFinish" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.IsBPFCommandsAvaialableOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.IsBusinessProcessEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.WorkflowWebResource.FinishProcess" Library="$Webresource:Main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddConnectionForm">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnlyOrDisabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CreateConnection" />
        <DisplayRule Id="Mscrm.IsConnectionsEnabledPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.addConnectionFromForm" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryControl" />
          <BoolParameter Value="false" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddConnectionToMeForm">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnlyOrDisabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.CreateConnection" />
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.IsConnectionsEnabledPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addConnectionFromForm" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryControl" />
          <BoolParameter Value="true" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddPrimaryToMarketingList">
      <EnableRules>
        <EnableRule Id="Mscrm.AddPrimaryToMarketingList" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddPrimaryToMarketingList" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Marketing.CommandActions.Instance.addCurrentItemToList" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.CreatePDF">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.IsExportPdfDocumentSdkAvilable" />
        <EnableRule Id="Mscrm.ShouldShowCreateAndEmailPDFRibbonCommand" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.CPQPDFGenerationFCBEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.CreatePDF.Populate.Flyout">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Sales.CommandBarActions.Instance.generatePDFTemplateFlyout" Library="$webresource:Sales/CommandBarActions/SalesCommandBarActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <BoolParameter Value="true" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.CreatePDF.Hide">
      <EnableRules>
        <EnableRule Id="Mscrm.Disabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.CreatePDF.GeneratePDF">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Sales.CommandBarActions.Instance.createPDFCommandHandler" Library="$webresource:Sales/CommandBarActions/SalesCommandBarActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.EmailAsPDF">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.IsCreateEmailWithEntityDocumentSdkAvilable" />
        <EnableRule Id="Mscrm.ShouldShowCreateAndEmailPDFRibbonCommand" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.CPQPDFGenerationFCBEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.EmailAsPDF.Populate.Flyout">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Sales.CommandBarActions.Instance.generatePDFTemplateFlyout" Library="$webresource:Sales/CommandBarActions/SalesCommandBarActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <BoolParameter Value="true" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.EmailAsPDF.Hide">
      <EnableRules>
        <EnableRule Id="Mscrm.Disabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.EmailAsPDF.GeneratePDFAndSendEmail">
      <EnableRules>
        <EnableRule Id="Mscrm.Enabled" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="Sales.CommandBarActions.Instance.emailAsPDFCommandHandler" Library="$webresource:Sales/CommandBarActions/SalesCommandBarActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="LinkedInExtensions.ViewOrgChart">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.HideOnMobile" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.IsOrgChartFeatureEnabled" />
        <DisplayRule Id="Mscrm.CanReadContact" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="LinkedInExtensions.Account.Instance.ViewOrgChart" Library="$webresource:LinkedInExtensions/Account/LinkedInExtensions_Account.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Command.DisplayRule.EntityPrivilegeRule" />
        <DisplayRule Id="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Command.DisplayRule.FormStateRule" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/GeoCodeUtils/GeoCodePopUp.Library.js" FunctionName="GeoCodePopUp.Library.OpenDialog">
          <CrmParameter Value="PrimaryControl" />
          <StringParameter Value="Account" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SharePrimaryRecordRefresh">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.SharePrimaryPermission" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.SharePrimaryPermission" />
        <DisplayRule Id="Mscrm.HybridDialogShareEnabled" />
        <DisplayRule Id="Mscrm.HideInLegacyRibbon" />
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Common.onActionMenuClick" Library="$webresource:Main_system_library.js">
          <StringParameter Value="share" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ShareSecuredFieldsPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.ShareSecuredFieldsPrimaryPermission" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShareSecuredFieldsPrimaryPermission" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Common.onActionMenuClickLegacy" Library="$webresource:Main_system_library.js">
          <StringParameter Value="grant" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.{!EntityLogicalName}.MainTab">
      <EnableRules>
        <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.MainTab" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SavePrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.AvailableOnForm" />
        <EnableRule Id="Mscrm.CanSavePrimary" />
        <EnableRule Id="Mscrm.ReadPrimaryPermission" />
        <EnableRule Id="Mscrm.IsAutoSaveDisable" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.HideSaveOnMobile" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanSavePrimaryEntityType" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Save.saveForm" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SavePrimaryActivityAsComplete">
      <EnableRules>
        <EnableRule Id="Mscrm.AvailableOnForm" />
        <EnableRule Id="Mscrm.CanSavePrimary" />
        <EnableRule Id="Mscrm.ReadPrimaryPermission" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.PrimaryIsActivity" />
        <DisplayRule Id="Mscrm.CanSavePrimaryEntityType" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Save.saveAsCompleted" Library="$webresource:Main_system_library.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SaveAndClosePrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.IsAutoSaveDisable" />
        <EnableRule Id="Mscrm.AvailableOnForm" />
        <EnableRule Id="Mscrm.CanSavePrimary" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.HideForSalesAccelerationShell" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanSaveAndClosePrimaryEntityType" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Save.saveAndCloseForm" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SaveAndNewPrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.AvailableOnForm" />
        <EnableRule Id="Mscrm.CanSavePrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.CreatePrimaryEntityPermission" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.saveAndNewForm" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.NewRecordFromForm">
      <EnableRules>
        <EnableRule Id="Mscrm.AvailableOnForm" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.PrimaryIsNotActivity" />
        <DisplayRule Id="Mscrm.HideInLegacyRibbon" />
        <DisplayRule Id="Mscrm.CreatePrimaryEntityPermission" />
        <DisplayRule Id="Mscrm.PrimaryEntityIsNotBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Open.openNewRecord" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.NewRecordForBPFEntity">
      <EnableRules>
        <EnableRule Id="Mscrm.AvailableOnForm" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsPUV2EntityCustomizationEnabled" />
        <DisplayRule Id="Mscrm.IsBPFEntityCustomizationFeatureEnabled" />
        <DisplayRule Id="Mscrm.PrimaryEntityIsBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.NewRecordForBPFEntity.openNewRecord" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Activate">
      <EnableRules>
        <EnableRule Id="Mscrm.CanWritePrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.PrimaryIsInactive" />
        <DisplayRule Id="Mscrm.PrimaryEntityHasStatecode" />
        <DisplayRule Id="Mscrm.PrimaryIsNotActivity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.changeState" Library="/_static/_common/scripts/CommandBarActions.js">
          <StringParameter Value="activate" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Deactivate">
      <EnableRules>
        <EnableRule Id="Mscrm.CanWritePrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.PrimaryIsActive" />
        <DisplayRule Id="Mscrm.PrimaryEntityHasStatecode" />
        <DisplayRule Id="Mscrm.PrimaryIsNotActivity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.changeState" Library="/_static/_common/scripts/CommandBarActions.js">
          <StringParameter Value="deactivate" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.OpenActiveStage">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsPUV2EntityCustomizationEnabled" />
        <DisplayRule Id="Mscrm.IsBPFEntityCustomizationFeatureEnabled" />
        <DisplayRule Id="Mscrm.PrimaryEntityIsBPFEntity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.OpenActiveStage.openActiveStageFromForm" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.CloseActivity">
      <EnableRules>
        <EnableRule Id="Mscrm.CanWritePrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanWritePrimary" />
        <DisplayRule Id="Mscrm.PrimaryIsActive" />
        <DisplayRule Id="Mscrm.PrimaryEntityHasStatecode" />
        <DisplayRule Id="Mscrm.PrimaryIsActivity" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.ChangeState.changeState" Library="$webresource:Main_system_library.js">
          <StringParameter Value="deactivate" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <StringParameter Value="5" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.ConvertToOpportunity">
      <EnableRules>
        <EnableRule Id="Mscrm.ConvertActivity" />
        <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline" />
        <EnableRule Id="Mscrm.IsOpportunityAvailableInMocaOffline" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ConvertActivity" />
        <DisplayRule Id="Mscrm.PrimaryIsNotCampaign" />
        <DisplayRule Id="Mscrm.HasOpportunityCreatePrivilege" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:Marketing/ClientCommon/Marketing_ClientCommon.js" />
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:Sales/ClientCommon/Sales_ClientCommon.js" />
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:Sales/CommandBarActions/SalesCommandBarActions.js" />
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:CRM/ClientUtility.js" />
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:MarketingSales/Localization/ResourceStringProvider.js" />
        <JavaScriptFunction FunctionName="MarketingSales.CommandBarActions.Instance.convertToOpportunityActivity" Library="$webresource:MarketingSales/CommandBarActions/MarketingSalesCommandBarActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.ConvertToCase">
      <EnableRules>
        <EnableRule Id="Mscrm.ConvertActivity" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ConvertActivity" />
        <DisplayRule Id="Mscrm.ShowOnInteractionCentricHideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="CrmService.Activity.Instance.convertToCase" Library="$webresource:Service/Activities/activity.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.PromoteToResponse">
      <EnableRules>
        <EnableRule Id="Mscrm.EnablePromoteToResponse" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.PrimaryIsActivity" />
        <DisplayRule Id="Mscrm.CanCreateActivity" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.promoteToResponse" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddPrimaryToQueue">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.WorksWithQueuePrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="AppCommon.Commands.Queue.AddRecordToQueue" Library="$webresource:AppCommon/Commands/QueueCommands.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.QueueItemDetail">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.QueueItemDetailEnableRule" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.AppendToQueue" />
        <DisplayRule Id="Mscrm.WorksWithQueuePrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="AppCommon.Commands.Queue.entityQueueItemDetail" Library="$webresource:AppCommon/Commands/QueueCommands.js">
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ViewHierarchyForPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.IsFormHierarchyEnabled" />
        <EnableRule Id="Mscrm.FormStateNotNew" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Hierarchy.ViewHierarchy" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ShareRecordsAndSecuredFieldsPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.ShareRecordsAndSecuredFieldsPrimaryPermission" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.ShareRecordsAndSecuredFieldsPrimaryPermission" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SharePrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.SharePrimaryPermission" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.SharePrimaryPermission" />
        <DisplayRule Id="Mscrm.HybridDialogShareEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Common.onActionMenuClick" Library="$webresource:Main_system_library.js">
          <StringParameter Value="share" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.CopyShortcutPrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.EnableInIEBrowser" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.sendFormShortcut" Library="/_static/_common/scripts/RibbonActions.js">
          <BoolParameter Value="false" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RunWorkflowPrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.RunWorkflowPrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.launchOnDemandWorkflowForm" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <StringParameter Value="" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.RunInteractiveWorkflowPrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.RunWorkflowPrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnModern" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.CommandBarActions.runScript" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Form.Flows.PopulateMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="true" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Form.Flows.PopulateStaticFlowMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateStaticFlowMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="true" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Form.Flows.PopulateFlowMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateFlowMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="true" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Form.Flows.PopulateWorkFlowMenu">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Flows.populateWorkFlowMenu" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <BoolParameter Value="true" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.WordTemplate">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.DocumentGenerationPrivilege" />
        <DisplayRule Id="Mscrm.WordTemplatesFCBEnabled" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.WordTemplate.Populate.Flyout">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Export.generateWordTemplateFlyout" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <BoolParameter Value="true" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ReportMenu.Form">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ReadReport" />
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.HybridDialogReportsEnabled" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ReportsMenu.Populate.Form">
      <EnableRules />
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.RunReport.generateReportMenuXml" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <BoolParameter Value="true" />
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.PDFCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.AppCommon.IsPdfEnabledForEntity" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.ShowOnlyInBrowsersForModern" />
        <DisplayRule Id="Mscrm.Pdf2020Wave2UpdatesEnabled" />
        <DisplayRule Id="Mscrm.October2020UpdateEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="AppCommon.CommandActions.LaunchPDFDialog" Library="$webresource:AppCommon/CommandActions/AppCommon_CommandActions.js">
          <CrmParameter Value="CommandProperties" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.ShareSecuredFieldsPrimaryRecordUCI">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.CheckIfEntityContainsecureField" />
        <EnableRule Id="Mscrm.ShowSharedSecuredFieldButtonInUCI" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsEnableGrantPermissionsOnUCIEnabled" />
        <DisplayRule Id="Mscrm.HideInLegacyRibbon" />
        <DisplayRule Id="Mscrm.ShareSecuredFieldsPrimaryPermissionUCI" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Common.onActionMenuClickLegacy" Library="$webresource:Main_system_library.js">
          <StringParameter Value="grant" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="AccessChecker.OpenDialogCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="FCB.EnableAccessChecker.IsEnabled" />
        <DisplayRule Id="IsModernClientType" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="openAccessChecker" Library="$webresource:accessChecker_openDialog.js">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Playbook.Form.Launch">
      <EnableRules>
        <EnableRule Id="Mscrm.IsPlaybookTemplateAvailable" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.CanLaunchPlaybook" />
        <DisplayRule Id="Mscrm.PrimaryIsActive" />
        <DisplayRule Id="Mscrm.IsPlaybookFeatureEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="PlaybookService.CommandBarActions.LaunchPlaybook" Library="$webresource:Playbook/CommandBarActions/Playbook_CommandBarActions_library.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.FollowCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="msdyn.ActivityFeeds.NotNewEnableRule" />
        <EnableRule Id="msdyn.ActivityFeeds.IsFollowButtonEnabled" />
        <EnableRule Id="msdyn.ActivityFeeds.Yammer.ShouldEnableFollow" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="msdyn.ActivityFeeds.ShowFollowButton" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.followFromForm">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.UnfollowCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="msdyn.ActivityFeeds.NotNewEnableRule" />
        <EnableRule Id="msdyn.ActivityFeeds.IsUnFollowButtonEnabled" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="msdyn.ActivityFeeds.ShowUnfollowButton" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.unfollowFromForm">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="MailApp.Form.SetRegardingCommand">
      <EnableRules>
        <EnableRule Id="MailApp.Rules.HasTrackAction" />
        <EnableRule Id="MailApp.Rules.IsTrackAllowed" />
        <EnableRule Id="MailApp.Rules.IsRecordSaved" />
        <EnableRule Id="MailApp.Rules.IsNotSetRegardingCurrentRecord" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="MailApp.Rules.HasActivities" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="MailApp.ContextualSetRegarding" Library="$webresource:new_MailAppScriptResource">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="MailApp.Form.OpenRecordOnWebCommand">
      <EnableRules>
        <EnableRule Id="MailApp.Rules.IsRecordSaved" />
        <EnableRule Id="MailApp.Rules.IsMailApp" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="FCB.MailAppOpenRecordInBrowser.IsEnabled" />
        <DisplayRule Id="IsModernClientType" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="MailApp.OpenRecordOnWeb" Library="$webresource:new_MailAppScriptResource">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.YammerCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Yammer.ShowYammer" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideForTabletExperience" />
        <DisplayRule Id="Mscrm.IsYammerEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Yammer.Commands.yammer" Library="$webresource:msdyn_/YammerIntegration/Yammer_main_system_library.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.MSTeamsCollaborateCommand">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="OfficeProductivity.RibbonRules.showMSTeamsCollaborateCommand" />
        <EnableRule Id="OfficeProductivity.RibbonRules.hideCollaborateCommandForContextualEmail" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.IsMSTeamsIntegrationEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="OfficeProductivity.RibbonCommands.showMSTeamsCollaborateDialog" Library="$webresource:msdyn_/OfficeProductivity_RibbonCommands.js">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="msdyn.ApplicationRibbon.Form.BookResource.Command">
      <EnableRules>
        <EnableRule Id="msdyn.ApplicationRibbon.Form.BookResource.EnableRule" />
      </EnableRules>
      <DisplayRules />
      <Actions>
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:msdyn_/fps/LocalizationLibrary/Localization.Library.js" />
        <JavaScriptFunction FunctionName="isNaN" Library="$webresource:msdyn_/fps/Utils/FpsUtils.js" />
        <JavaScriptFunction FunctionName="FpsUtils.Form.bookButtonAction" Library="$webresource:msdyn_/fps/Utils/FpsUtils.js">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="msdyn.ApplicationRibbon.Form.SaveAndRunRoutingRule.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.CanSaveAndRunRoutingRule" />
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.IsRoutingRuleCreatedForEntity" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.CanSaveAndRunRoutingRule" />
        <DisplayRule Id="Mscrm.HideOnUCICreate" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.EntityIsNotIncident" />
        <DisplayRule Id="Mscrm.IsAnyEntityRoutingRuleEnabled" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="AnyEntityRoutingRule.CommandBarActions.Instance.saveAndRunRoutingRuleAndClose" Library="$webresource:msdyn_/AnyEntityRoutingRule/CommandBarActions/AnyEntityRoutingRuleCommandBarActions.js">
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.QueueItemDetailOmnichannel">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.QueueItemDetailOmnichannelEnableRule" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.AppendToQueue" />
        <DisplayRule Id="Mscrm.WorksWithQueuePrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="OmniChannelPackage.CommandBarActions.Instance.QueueItemDetails" Library="$webresource:msdyn_OmniChannelCommandBarActions.js" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Cadence.Apply">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.HideOnMobile" />
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.Sequence.IsTargetEntityActive" />
        <EnableRule Id="Mscrm.IsEntityFormApplicableForCadence" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsSalesAccFeatureEnabled" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.DoesUserHaveSequencePrivileges" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Sales.SalesCadence.Instance.ApplyCadenceFromEntityForm" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.Sequence.Disconnect">
      <EnableRules>
        <EnableRule Id="Mscrm.NotOffline" />
        <EnableRule Id="Mscrm.HideOnMobile" />
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.Sequence.IsTargetEntityActive" />
        <EnableRule Id="Mscrm.Sequence.Form.IsApplicableForDisconnect" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.IsSalesAccFeatureEnabled" />
        <DisplayRule Id="Mscrm.ShowOnlyOnModern" />
        <DisplayRule Id="Mscrm.HideOnOutlookClient" />
        <DisplayRule Id="Mscrm.DoesUserHaveSequencePrivileges" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Sales.SalesCadence.Instance.DisconnectSequenceFromEntityForm" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="PrimaryControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.{!EntityLogicalName}.MainTab">
      <EnableRules>
        <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.MainTab" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.Relationship">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExisting" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.Relationship.Customer">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExisting" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship.Customer" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addRelatedToNonForm" Library="/_static/_common/scripts/RibbonActions.js">
          <IntParameter Value="4502" />
          <IntParameter Value="1" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.account.Relationship.Opportunity">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExisting" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship.Opportunity" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addRelatedToNonForm" Library="/_static/_common/scripts/RibbonActions.js">
          <IntParameter Value="4503" />
          <IntParameter Value="1" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.{!EntityLogicalName}.Related">
      <EnableRules>
        <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.Related" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
        <DisplayRule Id="Mscrm.PrimaryIsNotActivity" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddFileToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.IsNotIos" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.CreateAndAppendNote" />
        <DisplayRule Id="Mscrm.PrimaryEntityHasNotes" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addFileToRecord" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddNoteToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateNotNew" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AppendToPrimary" />
        <DisplayRule Id="Mscrm.CreateAndAppendNote" />
        <DisplayRule Id="Mscrm.PrimaryEntityHasNotes" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="Mscrm.RibbonActions.addNoteToRecord" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="FirstPrimaryItemId" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddTaskToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="task" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.SendEmailPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
        <EnableRule Id="Mscrm.AppendToPrimary" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
        <DisplayRule Id="Mscrm.WriteActivityPermission" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="email" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddPhoneToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="phonecall" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddLetterToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="letter" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddFaxToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="fax" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddAppointmentToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="appointment" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddRecurringAppointmentToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityOnForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="recurringappointmentmaster" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddServiceActivityToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
        <DisplayRule Id="Mscrm.CreateServiceAppointment" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityToForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="serviceappointment" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.AddCustomActivity">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
        <DisplayRule Id="Mscrm.HideOnModern" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.DynamicMenu.Form.AddActivity">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.MailMergePrimary">
      <EnableRules>
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
        <EnableRule Id="Mscrm.IsNotIos" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.MailMergePrimary" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="onActionMenuClick" Library="/_static/_forms/form.js">
          <StringParameter Value="webmailmerge" />
          <CrmParameter Value="PrimaryEntityTypeCode" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.AddCampaignResponseToPrimaryRecord">
      <EnableRules>
        <EnableRule Id="Mscrm.AppendToPrimary" />
        <EnableRule Id="Mscrm.FormStateExistingOrReadOnly" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.HideOnCommandBar" />
        <DisplayRule Id="Mscrm.AddActivityToPrimary" />
        <DisplayRule Id="Mscrm.CreateCampaignResponse" />
        <DisplayRule Id="Mscrm.PrimaryEntityHasCampaignResponse" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction FunctionName="XrmCore.Commands.Add.AddActivityToForm" Library="$webresource:Main_system_library.js">
          <StringParameter Value="campaignresponse" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.{!EntityLogicalName}.Related">
      <EnableRules>
        <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.Related" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
        <DisplayRule Id="Mscrm.PrimaryIsNotActivity" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.{!EntityLogicalName}.Developer">
      <EnableRules>
        <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.Developer" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
    <CommandDefinition Id="Mscrm.Form.{!EntityLogicalName}.Developer">
      <EnableRules>
        <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.Developer" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="Mscrm.NotOffline" />
        <DisplayRule Id="Mscrm.OpenCustomizations" />
        <DisplayRule Id="Mscrm.OutlookRenderTypeWeb" />
      </DisplayRules>
      <Actions />
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="ClientUtility.ClientUtil.ValidateSettingsForModernDevice">
        <CustomRule FunctionName="ClientUtility.ClientUtil.ValidateSettingsForModernDevice" Library="$webresource:CRM/ClientUtility.js" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HomepageGrid.account.MergeGroup">
        <MiscellaneousPrivilegeRule PrivilegeName="Merge" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanWriteAccount">
        <EntityPrivilegeRule EntityName="account" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HybridDialogMergeEnabled">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.HybridDialog.Merge" ExpectedValue="true" />
            <FeatureControlRule FeatureControlBit="FCB.AllowLegacyDialogsInUci" ExpectedValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.AddSelectedToMarketingList">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="list" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowOnlyOnModern">
        <CommandClientTypeRule Type="Modern" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.NotOffline">
        <CrmOfflineAccessStateRule State="Offline" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsOrgChartFeatureEnabled">
        <FeatureControlRule FeatureControlBit="FCB.OrgChart" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanReadContact">
        <EntityPrivilegeRule EntityName="contact" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WriteSelectedEntityPermission">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="FieldServiceFieldService.HomepageGrid.account.MainTab.HomeLocationGroup.B_buttonGeoCodeM.Command.DisplayRule.EntityPrivilegeRule">
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Basic" AppliesTo="SelectedEntity" EntityName="msdyn_fieldservicesetting" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreateSelectedEntityPermission">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Create" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowForNonRelationshipBoundGrids">
        <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="NoRelationship" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideNewForChildEntities">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsChildEntity" PropertyValue="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideAddressEntities">
        <EntityRule AppliesTo="SelectedEntity" EntityName="customeraddress" Default="false" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.NotOnMarketingList">
        <FormEntityContextRule Default="false" EntityName="list" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsPUV2EntityCustomizationEnabled">
        <FeatureControlRule FeatureControlBit="FCB.ProcessUnificationV2EntityCustomization" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsBPFEntityCustomizationFeatureEnabled">
        <OrganizationSettingRule Setting="IsBPFEntityCustomizationFeatureEnabled" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityIsBPFEntity">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsBPFEntity" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.BulkEditPrivilege">
        <MiscellaneousPrivilegeRule PrivilegeName="BulkEdit" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HybridDialogBulkEditEnabled">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.HybridDialog.BulkEdit" ExpectedValue="true" />
            <FeatureControlRule FeatureControlBit="FCB.AllowLegacyDialogsInUci" ExpectedValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanWriteSelected">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityHasStatecode">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="HasStateCode" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.DeleteSplitButtonDisplayRule">
        <OrRule>
          <Or>
            <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="ManyToMany" InvertResult="true" />
            <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Delete" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="GridFiltersEnabled" PropertyValue="true" />
            <MiscellaneousPrivilegeRule PrivilegeName="BulkDelete" />
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Delete" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.NotShowForManyToManyGrids">
        <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="ManyToMany" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.DeleteSelectedEntityPermission">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Delete" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.GridFiltersEnabled">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="GridFiltersEnabled" PropertyValue="true" />
        <PageRule Address="/advancedfind/fetchdata.aspx" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.BulkDelete">
        <MiscellaneousPrivilegeRule PrivilegeName="BulkDelete" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.DeletePrimaryEntityPermission">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Delete" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnModern">
        <CommandClientTypeRule Type="Modern" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.DuplicateDetectionEnabled">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="DuplicateDetectionEnabled" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsDataSetControlEnabled">
        <FeatureControlRule FeatureControlBit="FCB.DataSetControl" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WebClient">
        <CrmClientTypeRule Type="Web" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsNavigateToInUCIEnabled">
        <FeatureControlRule FeatureControlBit="FCB.NavigateToGridFromSubgrid" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WriteActivityPermission">
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityIsListedForSendDirectEmailOrEmailable">
        <OrRule>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="lead" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="opportunity" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="account" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="contact" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="socialprofile" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="incident" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="contract" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="quote" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="salesorder" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="invoice" Default="false" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="systemuser" Default="false" />
          </Or>
          <Or>
            <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsActivityParty" PropertyValue="true" />
            <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="HasEmailAddresses" PropertyValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.AssignSelectedEntityPermission">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Assign" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShareSelectedEntityPermission">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Share" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HybridDialogShareEnabled">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.HybridDialog.Share" ExpectedValue="true" />
            <FeatureControlRule FeatureControlBit="FCB.AllowLegacyDialogsInUci" ExpectedValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreateConnection">
        <MiscellaneousPrivilegeRule PrivilegeName="CreateConnection" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsConnectionsEnabledSelected">
        <EntityPropertyRule Default="false" AppliesTo="SelectedEntity" PropertyName="IsConnectionsEnabled" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnCommandBar">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Legacy" />
          </Or>
          <Or>
            <PageRule Address="/userdefined/edit.aspx" />
          </Or>
          <Or>
            <PageRule Address="/advancedfind/advfind.aspx" />
          </Or>
          <Or>
            <PageRule Address="/advancedfind/fetchData.aspx" />
          </Or>
          <Or>
            <PageRule Address="/tools/formeditor/formeditor.aspx" />
          </Or>
          <Or>
            <PageRule Address="/tools/visualizationdesigner/visualizationdesigner.aspx" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.AppendToSelected">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WorksWithQueueSelected">
        <EntityPropertyRule Default="false" AppliesTo="SelectedEntity" PropertyName="WorksWithQueue" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideForTabletExperience">
        <HideForTabletExperienceRule />
      </DisplayRule>
      <DisplayRule Id="Mscrm.MicrosoftFlows">
        <MiscellaneousPrivilegeRule PrivilegeName="Flow" />
        <FeatureControlRule FeatureControlBit="FCB.FlowIntegration" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnOutlookClient">
        <CrmClientTypeRule Type="Outlook" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsFlowSubMenuUCIEnabled">
        <FeatureControlRule FeatureControlBit="FCB.EnableFlowSubMenuUCI" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsOnDemandWorkflowUCIEnabled">
        <FeatureControlRule FeatureControlBit="FCB.OnDemandWorkflowUCI" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ReadReport">
        <EntityPrivilegeRule EntityName="report" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HybridDialogReportsEnabled">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.RunReportsInUci" ExpectedValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.DocumentGenerationPrivilege">
        <MiscellaneousPrivilegeRule PrivilegeName="DocumentGeneration" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.TemplatesFCBEnabled">
        <FeatureControlRule FeatureControlBit="FCB.Moca.ExcelDocumentTemplate" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WordTemplatesFCBEnabled">
        <FeatureControlRule FeatureControlBit="FCB.Moca.WordDocumentTemplate" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ExportToExcelPrivilege">
        <MiscellaneousPrivilegeRule PrivilegeName="ExportToExcel" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.Live">
        <SkuRule Sku="Online" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsExportToExcelFCBEnabled">
        <FeatureControlRule FeatureControlBit="FCB.ExportToExcel" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.NotAdvancedFind">
        <PageRule Address="/advancedfind/fetchdata.aspx" InvertResult="true" />
        <PageRule Address="/advancedfind/advfind.aspx" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnPhoneForNonModern">
        <OrRule>
          <Or>
            <DeviceTypeRule Type="Phone" InvertResult="true" />
          </Or>
          <Or>
            <CommandClientTypeRule Type="Modern" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowPivotXlsx">
        <OrRule>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.HideExportPivotTable" ExpectedValue="false" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowExportSelectedToExcel">
        <OrRule>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.ExportSelectedToExcel" ExpectedValue="true" />
          </Or>
          <Or>
            <FeatureControlRule FeatureControlBit="FCB.October2020Update" ExpectedValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ImportData">
        <EntityPrivilegeRule EntityName="import" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="import" PrivilegeType="Delete" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="import" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="import" PrivilegeType="Write" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="importmap" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="importmap" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="importmap" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityIsNotBPFEntity">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsBPFEntity" PropertyValue="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnSettingsCommandBarPage">
        <OrRule>
          <Or>
            <PageRule Address="/tools/business/business.aspx" InvertResult="true" />
            <PageRule Address="/tools/templates/templates.aspx" InvertResult="true" />
            <PageRule Address="/tools/admin/admin.aspx" InvertResult="true" />
            <PageRule Address="/tools/adminsecurity/adminsecurity_area.aspx" InvertResult="true" />
            <PageRule Address="/tools/productcatalog/productcatalog.aspx" InvertResult="true" />
            <PageRule Address="/tools/mobileoffline/mobileoffline.aspx" InvertResult="true" />
            <PageRule Address="/tools/datamanagement/datamanagement.aspx" InvertResult="true" />
            <PageRule Address="/tools/documentmanagement/documentmanagement.aspx" InvertResult="true" />
            <PageRule Address="/tools/audit/audit_area.aspx" InvertResult="true" />
            <PageRule Address="/tools/social/social_area.aspx" InvertResult="true" />
            <PageRule Address="/tools/systemcustomization/systemcustomization.aspx" InvertResult="true" />
            <PageRule Address="/tools/solution/home_solution.aspx" InvertResult="true" />
            <PageRule Address="/tools/SystemCustomization/SolutionsMarketplace/SolutionsMarketplace.aspx" InvertResult="true" />
            <PageRule Address="/tools/business/home_asyncoperation.aspx" InvertResult="true" />
            <PageRule Address="/tools/servicemanagement/servicemanagement.aspx" InvertResult="true" />
            <PageRule Address="/tools/externappmanagement/externappmanagement.aspx" InvertResult="true" />
            <PageRule Address="/tools/AppModuleContainer/applandingtilepage.aspx" InvertResult="true" />
          </Or>
          <Or>
            <CrmClientTypeRule Type="Outlook" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.OutlookClient">
        <CrmClientTypeRule Type="Outlook" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WriteCustomization">
        <MiscellaneousPrivilegeRule PrivilegeName="WriteCustomization" />
      </DisplayRule>
      <DisplayRule Id="AIBuilder.FCB.ShowAIBuilderCommandInUCI">
        <FeatureControlRule FeatureControlBit="FCB.ShowAiBuilderCommandInUCI" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanLaunchPlaybook">
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Create" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsPlaybookFeatureEnabled">
        <FeatureControlRule FeatureControlBit="FCB.Playbook" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="msdyn.ActivityFeeds.ShowFollowButton">
        <EntityRule AppliesTo="SelectedEntity" EntityName="postfollow" Default="true" InvertResult="true" />
        <EntityPrivilegeRule EntityName="postfollow" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="postfollow" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="msdyn.ActivityFeeds.ShowUnfollowButton">
        <EntityRule AppliesTo="SelectedEntity" EntityName="postfollow" Default="true" InvertResult="true" />
        <EntityPrivilegeRule EntityName="postfollow" PrivilegeType="Delete" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="postfollow" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="GuidedHelpDisplayRule">
        <CommandClientTypeRule Type="Modern" />
        <CrmClientTypeRule Type="Outlook" InvertResult="true" />
        <FeatureControlRule FeatureControlBit="FCB.GuidedHelp" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="LPPrivilegeRule">
        <MiscellaneousPrivilegeRule PrivilegeName="LearningPath" PrivilegeDepth="Global" Default="false" InvertResult="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsMSTeamsIntegrationEnabled">
        <FeatureControlRule FeatureControlBit="FCB.MSTeamsIntegration" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.EntityIsNotIncident">
        <FormEntityContextRule Default="true" EntityName="incident" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsAnyEntityRoutingRuleEnabled">
        <FeatureControlRule FeatureControlBit="FCB.AnyEntityRoutingRule" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsSalesAccFeatureEnabled">
        <FeatureControlRule FeatureControlBit="FCB.SalesAcceleration" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.DoesUserHaveSequencePrivileges">
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Basic" EntityName="msdyn_sequence" />
        <EntityPrivilegeRule PrivilegeType="Create" PrivilegeDepth="Basic" EntityName="msdyn_sequencetarget" />
        <EntityPrivilegeRule PrivilegeType="Write" PrivilegeDepth="Basic" EntityName="msdyn_sequencetarget" />
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Basic" EntityName="msdyn_sequencetarget" />
        <EntityPrivilegeRule PrivilegeType="Create" PrivilegeDepth="Basic" EntityName="msdyn_sequencetargetstep" />
        <EntityPrivilegeRule PrivilegeType="Write" PrivilegeDepth="Basic" EntityName="msdyn_sequencetargetstep" />
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Basic" EntityName="msdyn_sequencetargetstep" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnPhone">
        <DeviceTypeRule Type="Phone" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.OutlookClientNotVersion11">
        <OutlookVersionRule Version="2003" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.userquery.Create">
        <EntityPrivilegeRule PrivilegeType="Create" PrivilegeDepth="Basic" EntityName="userquery" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsEntityEnabledForCharts">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsEnabledForCharts" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.DisplayCharts">
        <OrRule>
          <Or>
            <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Read" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule EntityName="savedqueryvisualization" PrivilegeType="Read" PrivilegeDepth="Global" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.Create">
        <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Create" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.Read">
        <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.Write">
        <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.Delete">
        <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Delete" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.Assign">
        <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Assign" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.Share">
        <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Share" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HomepageGrid.account.QuickCampaign">
        <MiscellaneousPrivilegeRule PrivilegeName="AllowQuickCampaign" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.QuickCampaignAllowed">
        <MiscellaneousPrivilegeRule PrivilegeName="AllowQuickCampaign" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship">
        <EntityPrivilegeRule EntityName="relationshiprole" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="account" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
        <OrRule>
          <Or>
            <EntityPrivilegeRule EntityName="customerrelationship" PrivilegeType="Create" PrivilegeDepth="Basic" />
            <EntityPrivilegeRule EntityName="customerrelationship" PrivilegeType="Append" PrivilegeDepth="Basic" />
            <EntityPrivilegeRule EntityName="contact" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule EntityName="customeropportunityrole" PrivilegeType="Create" PrivilegeDepth="Basic" />
            <EntityPrivilegeRule EntityName="customeropportunityrole" PrivilegeType="Append" PrivilegeDepth="Basic" />
            <EntityPrivilegeRule EntityName="opportunity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship.Opportunity">
        <EntityPrivilegeRule EntityName="relationshiprole" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="customeropportunityrole" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="customeropportunityrole" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="opportunity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="account" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HomepageGrid.account.Relationship.Customer">
        <EntityPrivilegeRule EntityName="relationshiprole" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="customerrelationship" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="customerrelationship" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="contact" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="account" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreateAndAppendNote">
        <EntityPrivilegeRule EntityName="annotation" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="annotation" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="annotation" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="annotation" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityHasNotes">
        <OrRule>
          <Or>
            <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="HasNotes" PropertyValue="true" />
          </Or>
          <Or>
            <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsActivity" PropertyValue="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.AddActivityToSelected">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="HasActivities" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreateServiceAppointment">
        <EntityPrivilegeRule EntityName="service" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="service" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.MailMergeSelected">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="MailMergeEnabled" PropertyValue="true" />
        <MiscellaneousPrivilegeRule PrivilegeName="MailMerge" />
        <EntityPrivilegeRule EntityName="mailmergetemplate" PrivilegeType="Read" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Write" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
        <OrRule>
          <Or>
            <CrmClientTypeRule Type="Outlook" />
          </Or>
          <Or>
            <MiscellaneousPrivilegeRule PrivilegeName="WebMailMerge" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreateCampaignResponse">
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <OrRule>
          <Or>
            <EntityPrivilegeRule EntityName="campaign" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityHasCampaignResponse">
        <OrRule>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="account" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="contact" />
          </Or>
          <Or>
            <EntityRule AppliesTo="SelectedEntity" EntityName="lead" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.OpenCustomizations">
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Global" EntityName="solution" />
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Global" EntityName="publisher" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.savedquery.Update">
        <EntityPrivilegeRule PrivilegeType="Write" PrivilegeDepth="Global" EntityName="savedquery" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsCustomizable">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsCustomizable" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.savedquery.Create">
        <EntityPrivilegeRule PrivilegeType="Create" PrivilegeDepth="Global" EntityName="savedquery" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowOnGridAndLegacy">
        <OrRule>
          <Or>
            <EntityRule Context="HomePageGrid" />
          </Or>
          <Or>
            <CommandClientTypeRule Type="Legacy" />
          </Or>
          <Or>
            <PageRule Address="/userdefined/edit.aspx" />
          </Or>
          <Or>
            <PageRule Address="/advancedfind/advfind.aspx" />
          </Or>
          <Or>
            <PageRule Address="/advancedfind/fetchData.aspx" />
          </Or>
          <Or>
            <PageRule Address="/tools/formeditor/formeditor.aspx" />
          </Or>
          <Or>
            <PageRule Address="/tools/visualizationdesigner/visualizationdesigner.aspx" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.savedquery.Read">
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Global" EntityName="savedquery" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowInHomePageGrid">
        <EntityRule Context="HomePageGrid" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowOnHomePageAspxOrOutlook">
        <OrRule>
          <Or>
            <PageRule Address="/_root/homepage.aspx" />
          </Or>
          <Or>
            <PageRule Address="/_grid/OutlookRibbonContextGrid.aspx" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.userqueryvisualization.CreateOrWrite">
        <OrRule>
          <Or>
            <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Create" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule EntityName="userqueryvisualization" PrivilegeType="Write" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowForManyToManyGrids">
        <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="ManyToMany" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AppendToPrimary">
        <EntityPrivilegeRule PrivilegeType="AppendTo" PrivilegeDepth="Basic" AppliesTo="PrimaryEntity" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AddExisting">
        <ReferencingAttributeRequiredRule Default="false" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AppendSelected">
        <EntityPrivilegeRule AppliesTo="SelectedEntity" PrivilegeType="Append" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnQCEntityForm">
        <OrRule>
          <Or>
            <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="ManyToMany" InvertResult="true" />
          </Or>
          <Or>
            <FormEntityContextRule Default="false" EntityName="bulkoperation" InvertResult="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnCAEntityForm">
        <OrRule>
          <Or>
            <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="ManyToMany" InvertResult="true" />
          </Or>
          <Or>
            <FormEntityContextRule Default="false" EntityName="campaignactivity" InvertResult="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnUciList">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <FormEntityContextRule Default="false" EntityName="list" InvertResult="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnListEntityForm">
        <FormEntityContextRule Default="false" EntityName="list" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreateOpportunity">
        <EntityPrivilegeRule EntityName="opportunity" PrivilegeType="Create" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowInSubGridStandard">
        <EntityRule Context="SubGridStandard" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideInLegacyRibbon">
        <CommandClientTypeRule Type="Legacy" InvertResult="true" />
        <PageRule Address="/userdefined/edit.aspx" InvertResult="true" />
        <PageRule Address="/advancedfind/advfind.aspx" InvertResult="true" />
        <PageRule Address="/advancedfind/fetchData.aspx" InvertResult="true" />
        <PageRule Address="/tools/formeditor/formeditor.aspx" InvertResult="true" />
        <PageRule Address="/tools/visualizationdesigner/visualizationdesigner.aspx" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowForOneToManyGrids">
        <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="OneToMany" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideAddNewForChildEntities">
        <OrRule>
          <Or>
            <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsChildEntity" PropertyValue="false" />
          </Or>
          <Or>
            <RelationshipTypeRule AppliesTo="SelectedEntity" AllowCustomRelationship="false" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowForOneToManyForAllAndNonRelationshipBoundForMarketingListGrids">
        <OrRule>
          <Or>
            <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="OneToMany" />
          </Or>
          <Or>
            <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="NoRelationship" />
            <FormEntityContextRule Default="false" EntityName="list" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowOnManyToManyExceptCAForm">
        <RelationshipTypeRule AppliesTo="SelectedEntity" RelationshipType="ManyToMany" />
        <FormEntityContextRule Default="false" EntityName="campaignactivity" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WriteIncident">
        <EntityPrivilegeRule EntityName="incident" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WorksWithMergeAndParentChild">
        <EntityRule AppliesTo="SelectedEntity" EntityName="incident" Default="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SelectedEntityIsActivity">
        <EntityPropertyRule AppliesTo="SelectedEntity" PropertyName="IsActivity" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="MailApp.Rules.HasActivities.Subgrid">
        <EntityPropertyRule PropertyName="HasActivities" PropertyValue="true" AppliesTo="SelectedEntity" Default="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AssignPrimaryPermission">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Assign" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.NotClosedActivity">
        <OrRule>
          <Or>
            <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsActivity" PropertyValue="false" />
          </Or>
          <Or>
            <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsActivity" PropertyValue="true" />
            <ValueRule Value="Open" Field="statecode" />
          </Or>
          <Or>
            <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsActivity" PropertyValue="true" />
            <ValueRule Value="Scheduled" Field="statecode" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanWritePrimary">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsBusinessProcessEnabled">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsBusinessProcessEnabled" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanActivateBusinessProcessFlows">
        <MiscellaneousPrivilegeRule PrivilegeName="ActivateBusinessProcessFlow" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsConnectionsEnabledPrimary">
        <EntityPropertyRule Default="false" AppliesTo="PrimaryEntity" PropertyName="IsConnectionsEnabled" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AddPrimaryToMarketingList">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="list" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CPQPDFGenerationFCBEnabled">
        <FeatureControlRule FeatureControlBit="FCB.CPQPDFGeneration" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Command.DisplayRule.EntityPrivilegeRule">
        <EntityPrivilegeRule PrivilegeDepth="Basic" AppliesTo="SelectedEntity" PrivilegeType="Write" />
        <EntityPrivilegeRule PrivilegeType="Read" PrivilegeDepth="Basic" AppliesTo="SelectedEntity" EntityName="msdyn_fieldservicesetting" />
      </DisplayRule>
      <DisplayRule Id="FieldServiceFieldService.Form.account.MainTab.LocationGroup.B_buttonGeoCode.Command.DisplayRule.FormStateRule">
        <FormStateRule State="ReadOnly" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.SharePrimaryPermission">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Share" PrivilegeDepth="Basic" />
        <FormEntityContextRule EntityName="bulkoperation" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.OutlookRenderTypeWeb">
        <OutlookRenderTypeRule Type="Web" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShareSecuredFieldsPrimaryPermission">
        <EntityPrivilegeRule EntityName="principalobjectattributeaccess" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanSavePrimaryEntityType">
        <OrRule>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Create" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryIsActivity">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsActivity" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanSaveAndClosePrimaryEntityType">
        <OrRule>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Create" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.CreatePrimaryEntityPermission">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Create" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryIsNotActivity">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsActivity" PropertyValue="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryEntityIsNotBPFEntity">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsBPFEntity" PropertyValue="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryEntityIsBPFEntity">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsBPFEntity" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryIsInactive">
        <FormStateRule State="Disabled" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryEntityHasStatecode">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="HasStateCode" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryIsActive">
        <FormStateRule State="Existing" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ConvertActivity">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="IsActivity" PropertyValue="true" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Write" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryIsNotCampaign">
        <EntityRule AppliesTo="PrimaryEntity" EntityName="campaignactivity" InvertResult="true" />
        <EntityRule AppliesTo="PrimaryEntity" EntityName="campaignresponse" InvertResult="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.HasOpportunityCreatePrivilege">
        <EntityPrivilegeRule PrivilegeType="Create" PrivilegeDepth="Basic" EntityName="opportunity" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowOnInteractionCentricHideOnModern">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <DeviceTypeRule Type="InteractionCentric" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanCreateActivity">
        <MiscellaneousPrivilegeRule PrivilegeName="CreateActivity" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.WorksWithQueuePrimary">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="WorksWithQueue" PropertyValue="true" Default="false" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AppendToQueue">
        <EntityPrivilegeRule PrivilegeType="AppendTo" PrivilegeDepth="Basic" EntityName="queue" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShareRecordsAndSecuredFieldsPrimaryPermission">
        <OrRule>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Share" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule EntityName="principalobjectattributeaccess" PrivilegeType="Read" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShowOnlyInBrowsersForModern">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <CommandClientTypeRule Type="Modern" />
            <CrmClientTypeRule Type="Outlook" InvertResult="true" />
            <DeviceTypeRule Type="Phone" InvertResult="true" />
            <HideForTabletExperienceRule />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.Pdf2020Wave2UpdatesEnabled">
        <FeatureControlRule FeatureControlBit="FCB.PDF2020Wave2Updates" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.October2020UpdateEnabled">
        <FeatureControlRule FeatureControlBit="FCB.October2020Update" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsEnableGrantPermissionsOnUCIEnabled">
        <FeatureControlRule FeatureControlBit="FCB.EnableGrantPermissionOnUCI" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.ShareSecuredFieldsPrimaryPermissionUCI">
        <EntityPrivilegeRule EntityName="principalobjectattributeaccess" PrivilegeType="Read" PrivilegeDepth="Basic" />
      </DisplayRule>
      <DisplayRule Id="FCB.EnableAccessChecker.IsEnabled">
        <FeatureControlRule FeatureControlBit="FCB.EnableAccessChecker" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="IsModernClientType">
        <CommandClientTypeRule Type="Modern" />
      </DisplayRule>
      <DisplayRule Id="MailApp.Rules.HasActivities">
        <EntityPropertyRule PropertyName="HasActivities" PropertyValue="true" AppliesTo="PrimaryEntity" Default="false" />
      </DisplayRule>
      <DisplayRule Id="FCB.MailAppOpenRecordInBrowser.IsEnabled">
        <FeatureControlRule FeatureControlBit="FCB.MailAppOpenRecordInBrowser" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.IsYammerEnabled">
        <FeatureControlRule FeatureControlBit="FCB.YammerPostsOnUCI" ExpectedValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.CanSaveAndRunRoutingRule">
        <OrRule>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
            <FormStateRule State="Existing" />
          </Or>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Create" PrivilegeDepth="Basic" />
          </Or>
          <Or>
            <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" PrivilegeDepth="Basic" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.HideOnUCICreate">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <FormStateRule State="Create" InvertResult="true" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryEntityHasNotes">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="HasNotes" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.AddActivityToPrimary">
        <EntityPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="AppendTo" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Append" PrivilegeDepth="Basic" />
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="HasActivities" PropertyValue="true" />
      </DisplayRule>
      <DisplayRule Id="Mscrm.MailMergePrimary">
        <EntityPropertyRule AppliesTo="PrimaryEntity" PropertyName="MailMergeEnabled" PropertyValue="true" />
        <EntityPrivilegeRule EntityName="activitypointer" PrivilegeType="Create" PrivilegeDepth="Basic" />
        <MiscellaneousPrivilegeRule PrivilegeName="MailMerge" />
        <OrRule>
          <Or>
            <MiscellaneousPrivilegeRule PrivilegeName="WebMailMerge" />
          </Or>
          <Or>
            <CrmClientTypeRule Type="Outlook" />
          </Or>
        </OrRule>
      </DisplayRule>
      <DisplayRule Id="Mscrm.PrimaryEntityHasCampaignResponse">
        <OrRule>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="account" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="contact" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="lead" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="incident" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="opportunity" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="quote" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="invoice" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="salesorder" />
          </Or>
          <Or>
            <EntityRule AppliesTo="PrimaryEntity" EntityName="contract" />
          </Or>
        </OrRule>
      </DisplayRule>
    </DisplayRules>
    <EnableRules>
      <EnableRule Id="Mscrm.NotOffline">
        <CrmOfflineAccessStateRule State="Offline" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.SelectionCountOneOrTwo">
        <SelectionCountRule Minimum="1" Maximum="2" AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="Mscrm.VisualizationPaneNotMaximized">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" />
          </Or>
          <Or>
            <CustomRule FunctionName="Mscrm.GridCommandActions.disableButtonsWhenChartMaximized" Library="/_static/_common/scripts/CommandBarActions.js">
              <CrmParameter Value="SelectedControl" />
            </CustomRule>
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.SelectionCountAtLeastOne">
        <SelectionCountRule Minimum="1" AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="Mscrm.NotAListForm">
        <CustomRule FunctionName="Marketing.List.Commands.isListForm" Library="$webresource:Marketing/List/List_main_system_library.js" Default="true" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.SelectionCountExactlyOne">
        <SelectionCountRule Minimum="1" Maximum="1" AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="Mscrm.HideOnMobile">
        <CustomRule FunctionName="XrmCore.InternalUtilities.DialogUtilities.isMobileCompanionApp" Library="$webresource:Main_system_library.js" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.Enabled">
        <CustomRule FunctionName="XrmCore.Rules.Enabled.alwaysEnabled" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.HomepageGrid.{!EntityLogicalName}.MainTab">
        <EntityRule AppliesTo="SelectedEntity" EntityName="{!EntityLogicalName}" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsValidForHierarchyView">
        <CustomRule FunctionName="XrmCore.Rules.HierarchyView.isValidForHierarchyView" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsValidForHierarchyPageInUC">
        <CustomRule FunctionName="XrmCore.Rules.HierarchyView.isValidForHierarchyPageInUC" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsEntityAvailableForUserInMocaOffline">
        <CustomRule Library="$webresource:Main_system_library.js" FunctionName="XrmCore.Rules.Online.IsEntityAvailableForUserInMocaOffline">
          <CrmParameter Value="SelectedEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.PrimaryIsNotActivityHomePageGrid">
        <CustomRule FunctionName="XrmCore.Rules.Enabled.PrimaryIsNotActivityHomePageGrid" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.CheckBulkEditSupportForEntity">
        <CustomRule FunctionName="XrmCore.InternalUtilities.DialogUtilities.isMobileCompanionApp" Library="$webresource:Main_system_library.js" InvertResult="true" />
        <OrRule>
          <Or>
            <SelectionCountRule Minimum="1" Maximum="1" AppliesTo="SelectedEntity" />
          </Or>
          <Or>
            <SelectionCountRule Minimum="2" AppliesTo="SelectedEntity" />
            <CustomRule FunctionName="XrmCore.Commands.BulkEdit.isBulkEditEnabledForEntity" Library="$webresource:Main_system_library.js">
              <CrmParameter Value="SelectedEntityTypeName" />
            </CustomRule>
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ShowOnNonModernAndModernIfAllowed">
        <OrRule>
          <Or>
            <CommandClientTypeRule Type="Modern" InvertResult="true" />
          </Or>
          <Or>
            <CustomRule FunctionName="XrmCore.InternalUtilities.DialogUtilities.isAllowLegacyDialogsEmbedding" Library="$webresource:Main_system_library.js" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.DeleteSplitButtonEnableRule">
        <OrRule>
          <Or>
            <CustomRule FunctionName="XrmCore.Rules.Charts.disableButtonsWhenChartMaximized" Library="$webresource:Main_system_library.js">
              <CrmParameter Value="SelectedControl" />
            </CustomRule>
          </Or>
          <Or>
            <CommandClientTypeRule Type="Modern" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.AnySelection">
        <SelectionCountRule AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="Mscrm.FormStateNotNew">
        <FormStateRule State="Create" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShowOnDashboardPageUCI">
        <CommandClientTypeRule Type="Modern" />
        <CustomRule FunctionName="XrmCore.Rules.Dashboard.isDashboardPage" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShareValid">
        <CustomRule FunctionName="XrmCore.Commands.Share.isShareValid" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.IsRecordHierarchyEnabled">
        <CustomRule FunctionName="XrmCore.Rules.Hierarchy.IsRecordHierarchyEnabled" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnableInIEBrowser">
        <CustomRule FunctionName="Mscrm.IsIEBrowser_0" Library="$Webresource:Ribbon_main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.RunWorkflowSelected">
        <CustomRule FunctionName="Mscrm.GridRibbonActions.enableWorkflowOnGrid" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.IsMicrosoftFlowIntegrationEnabled">
        <CustomRule FunctionName="XrmCore.Commands.Flows.isMicrosoftFlowEnabled" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.DisplayFlowSingleMenu">
        <CustomRule FunctionName="XrmCore.Commands.Flows.displayFlowSingleMenu" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.ExportToExcel.ValidForXlsxExport">
        <CustomRule FunctionName="XrmCore.Rules.Export.EnabledForXlsxExport" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ExportToExcel">
        <CustomRule FunctionName="XrmCore.Rules.Export.EnableExportToExcel" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.SelectionCountNoneOrOutlook">
        <OrRule>
          <Or>
            <SelectionCountRule Minimum="1" AppliesTo="SelectedEntity" InvertResult="true" />
          </Or>
          <Or>
            <CrmClientTypeRule Type="Outlook" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnableExportToExcelOnlineForModern">
        <CustomRule FunctionName="XrmCore.Rules.Enabled.enableExportToExcelOnlineForModern" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableOnlyInBrowsersForModern">
        <CustomRule FunctionName="XrmCore.Rules.Export.EnableOnlyInBrowsersForModern" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableImportForWeb">
        <CustomRule FunctionName="XrmCore.Rules.Enabled.enableImportForWeb" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsNotIos">
        <CustomRule FunctionName="Mscrm.IsIos_0" Library="$Webresource:Ribbon_main_system_library.js" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.CanExportDataTemplate">
        <CustomRule FunctionName="Mscrm.GridRibbonActions.isValidForExportDataTemplate" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnableFiltersButton">
        <CustomRule FunctionName="Mscrm.RibbonActions.canEnableFiltersOnGrid" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ShowOnlyInOutlookExplorerOrInspector">
        <CustomRule FunctionName="Mscrm.RibbonActions.isOutlookExplorerOrInspector" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="AIBuilder.IsPAIEnabled">
        <CustomRule Default="false" FunctionName="AIBuilder.Commands.IsPAIEnabled" Library="$webresource:msdyn_AIBuilder.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.Disabled">
        <CustomRule FunctionName="XrmCore.Rules.Enabled.neverEnabled" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsBulkEmailInUciEnabled">
        <CustomRule FunctionName="Activities.BulkEmailDialog.IsSendBulkEmailInUciEnabled" Library="$webresource:Activities/SystemLibraries/InsertEmailTemplate.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsPlaybookTemplateAvailableFromGrid">
        <CustomRule FunctionName="PlaybookService.GridCommandBarActions.IsDisplayPlayBook" Library="$webresource:Playbook/CommandBarActions/Playbook_CommandBarActions_library.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.IsEntityWallEnabledActive">
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/Scripts/PlatformScriptLoader.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/InstalledLocales.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowEnabled.isEntityWallEnabled">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="true" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.Yammer.ShouldEnableFollow">
        <CustomRule Default="true" FunctionName="Follow.FollowEnableYammerCheck.shouldEnableFollow" Library="$webresource:msdyn_/Follow.Command.js">
          <CrmParameter Value="PrimaryEntityTypeCode" />
          <CrmParameter Value="SelectedEntityTypeCode" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.IsMultiRecordFollowAllowed">
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowEnabled.isMultiRecordFollowAllowed">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.IsEntityWallEnabledInActive">
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/Scripts/PlatformScriptLoader.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/InstalledLocales.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowEnabled.isEntityWallEnabled">
          <CrmParameter Value="SelectedControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
          <BoolParameter Value="false" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="IsGuidedHelpEnabled">
        <CustomRule FunctionName="enableGuidedHelp" Library="$webresource:msdyn_LoadGuidedHelpMoCA.js" Default="true" InvertResult="false" />
      </EnableRule>
      <EnableRule Id="LPLibraryEnabled">
        <CustomRule FunctionName="enableLearningPathDesigner" Library="$webresource:msdyn_LoadGuidedHelpMoCA.js" Default="true" InvertResult="false" />
      </EnableRule>
      <EnableRule Id="IsNotISH">
        <CustomRule FunctionName="isNotISH" Library="$webresource:msdyn_LoadGuidedHelpMoCA.js" Default="true" InvertResult="false" />
      </EnableRule>
      <EnableRule Id="OfficeProductivity.RibbonRules.showMSTeamsViewCollaborateCommand">
        <CustomRule FunctionName="OfficeProductivity.RibbonRules.showMSTeamsViewCollaborateCommand" Library="$webresource:msdyn_/OfficeProductivity_RibbonRules.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ApplicationRibbon.HomeGrid.BookResource.EnableRule">
        <CustomRule FunctionName="FpsUtils.Form.isBookButtonEnabled" Library="$webresource:msdyn_/fps/Utils/FpsUtils.js" Default="false">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </CustomRule>
        <SelectionCountRule AppliesTo="SelectedEntity" Minimum="1" Maximum="1" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsRoutingRuleCreatedForEntity">
        <CustomRule FunctionName="AnyEntityRoutingRule.CommandBarActions.Instance.isRoutingRuleCreatedForEntity" Library="$webresource:msdyn_/AnyEntityRoutingRule/CommandBarActions/AnyEntityRoutingRuleCommandBarActions.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="MsUSD.HideAddtoConfigurationButton">
        <CustomRule FunctionName="USD.IsAssociatedWithConfiguration" Library="$Webresource:msdyusd_/Scripts/USD_main_system_library.js" InvertResult="false">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="MsUSD.SelectionCountMinimumOne">
        <SelectionCountRule AppliesTo="SelectedEntity" Minimum="1" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsEntityApplicableForCadence">
        <CustomRule FunctionName="Sales.SalesCadence.Instance.IsCadenceEnabledForTargetEntity" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="PrimaryControl" />
          <BoolParameter Value="true" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Sequence.Grid.IsApplicableForDisconnect">
        <CustomRule FunctionName="Sales.SalesCadence.Instance.IsCadenceEnabledForTargetEntity" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
          <CrmParameter Value="PrimaryControl" />
          <BoolParameter Value="false" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnablePowerBIQuickReport">
        <CustomRule FunctionName="XrmCore.Commands.PowerBI.enablePowerBiQuickReport" Library="$webresource:Main_system_library.js" Default="false" />
      </EnableRule>
      <EnableRule Id="Mscrm.SetDefaultGridViewButtonEnabled">
        <CustomRule FunctionName="Mscrm.RibbonActions.enableSetDefaultGridViewButton" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableOnHomePageAspx">
        <PageRule Address="/_root/homepage.aspx" />
      </EnableRule>
      <EnableRule Id="Mscrm.UserQuerySelected">
        <CustomRule FunctionName="Mscrm.RibbonActions.isUserQuerySelected" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnableSaveButton">
        <CustomRule FunctionName="Mscrm.GridCommandActions.canEnableSaveButton" Library="/_static/_common/scripts/CommandBarActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnableChartsButton">
        <CustomRule FunctionName="Mscrm.RibbonActions.enableChartsButton" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.VisualizationPaneRuntimeMode">
        <CustomRule FunctionName="Mscrm.RibbonActions.isVisualizationPaneInRuntimeMode" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsFetchxmlQuery">
        <CustomRule FunctionName="Mscrm.RibbonActions.isFetchxmlQuery" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsChartSelected">
        <CustomRule FunctionName="Mscrm.RibbonActions.isChartSelected" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.UserVisualizationSelected">
        <CustomRule FunctionName="Mscrm.RibbonActions.isUserQueryVisualizationSelected" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsParentChartLoaded">
        <CustomRule FunctionName="Mscrm.RibbonActions.isDrilldownMode" Library="/_static/_common/scripts/RibbonActions.js" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsDefaultVisualizationModule">
        <CustomRule FunctionName="Mscrm.RibbonActions.isDefaultVisualizationModule" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableSaveAsChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.isSaveAsChartEnabled" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsDeleteVisualizationEnabled">
        <CustomRule FunctionName="Mscrm.RibbonActions.isDeleteVisualizationEnabled" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableOnHomePageAspxOrOutlook">
        <OrRule>
          <Or>
            <PageRule Address="/_root/homepage.aspx" />
          </Or>
          <Or>
            <PageRule Address="/_grid/OutlookRibbonContextGrid.aspx" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnableAssignShareChartButton">
        <CustomRule FunctionName="Mscrm.RibbonActions.enableAssignShareChartButton" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.VisualizationPaneRuntimeOrEditMode">
        <CustomRule FunctionName="Mscrm.RibbonActions.isVisualizationPaneInRuntimeOrEditMode" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.SelectionCountAtLeastZero">
        <SelectionCountRule Minimum="0" AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="Mscrm.HomepageGrid.{!EntityLogicalName}.Developer">
        <CustomRule FunctionName="Mscrm.RibbonActions.gridPageDeveloperTabEnableRule" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsSystemViewLoaded">
        <CustomRule FunctionName="Mscrm.RibbonActions.isSystemViewLoaded" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.SystemQuerySelected">
        <CustomRule FunctionName="Mscrm.RibbonActions.isSystemQuerySelected" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ShowVisualizationToolsRibbon">
        <CustomRule FunctionName="Mscrm.RibbonActions.showVisualizationToolsRibbon" Library="/_static/_common/scripts/RibbonActions.js" Default="false" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableSaveChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.isSaveChartEnabled" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.VisualizationPaneDesignerMode">
        <CustomRule FunctionName="Mscrm.RibbonActions.isVisualizationPaneInDesignerMode" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.NotComplexChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.isComplexChart" Library="/_static/_common/scripts/RibbonActions.js" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.Enable.IsVisualizationCustomizableRule">
        <CustomRule FunctionName="Mscrm.RibbonActions.canCustomizeVisualization" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.Visualization.CanApplyColumnChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.canApplyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Column" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Visualization.CanApplyBarChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.canApplyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Bar" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Visualization.CanApplyAreaChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.canApplyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Area" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Visualization.CanApplyLineChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.canApplyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Line" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Visualization.CanApplyPieChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.canApplyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Pie" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Visualization.CanApplyFunnelChart">
        <CustomRule FunctionName="Mscrm.RibbonActions.canApplyChartType" Library="/_static/_common/scripts/RibbonActions.js">
          <StringParameter Value="Funnel" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.TopBottomEnabled">
        <CustomRule FunctionName="Mscrm.RibbonActions.isTopBottomEnabled" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.AppendToPrimary">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="AppendTo" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsListStatic">
        <CustomRule FunctionName="Marketing.List.Commands.isListStatic" Library="$webresource:Marketing/List/List_main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsListUnLocked">
        <CustomRule FunctionName="Marketing.List.Commands.isListLocked" Library="$webresource:Marketing/List/List_main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.SubGrid.EnableRule.SubgridEntityMatchesTarget">
        <CustomRule FunctionName="Marketing.CommandActions.Instance.showButtonForListEntityOnly" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js" Default="false">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EntityFormIsEnabled">
        <FormStateRule State="Disabled" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsUci">
        <CustomRule FunctionName="Xrm.Internal.isUci" Library="$webresource:Marketing/ClientCommon/Marketing_ClientCommon.js" Default="true" InvertResult="false" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsListForm">
        <CustomRule FunctionName="Marketing.List.Commands.isListForm" Library="$webresource:Marketing/List/List_main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.AccountOrContactMemberType">
        <CustomRule FunctionName="Marketing.List.CommandActions.isAccountOrContactMemberType" Library="$webresource:Marketing/List/List_main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.SubGrid.{!EntityLogicalName}.MainTab">
        <EntityRule AppliesTo="SelectedEntity" EntityName="{!EntityLogicalName}" />
      </EnableRule>
      <EnableRule Id="Mscrm.EnableRibbonOnSubGrid">
        <FormStateRule State="Create" InvertResult="true" Default="false" />
        <CustomRule FunctionName="Mscrm.RibbonActions.enableRibbonOnSubGrid" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.isNotDynamicList">
        <CustomRule FunctionName="Marketing.List.Commands.isNotDynamicList" Library="$webresource:Marketing/List/List_main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.SubGrid.EnableRule.SubgridEntityMatchesTargetWebClientOnly">
        <CustomRule FunctionName="Marketing.CommandActions.Instance.showButtonForListEntityOnlyWebClient" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js" Default="false">
          <CrmParameter Value="SelectedEntityTypeName" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <CrmParameter Value="SelectedControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.SelectionCountAtLeastTwo">
        <SelectionCountRule Minimum="2" AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="Mscrm.SubGrid.{!EntityLogicalName}.ContextualTabs">
        <EntityRule AppliesTo="SelectedEntity" EntityName="{!EntityLogicalName}" />
      </EnableRule>
      <EnableRule Id="MailApp.Rules.SelectionCountExactlyOne">
        <SelectionCountRule Minimum="1" Maximum="1" AppliesTo="SelectedEntity" />
      </EnableRule>
      <EnableRule Id="MailApp.Rules.HasTrackAction">
        <CustomRule Default="false" FunctionName="HasMailContextAction" Library="$webresource:new_MailAppScriptResource">
          <StringParameter Value="TRACK" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="MailApp.Rules.HasTrackStatusProperty">
        <CustomRule Default="false" FunctionName="HasMailContextProperty" Library="$webresource:new_MailAppScriptResource">
          <StringParameter Value="TRACK_STATUS" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="MailApp.Rules.IsNotSetRegardingSelectedRecord">
        <CustomRule Default="false" FunctionName="IsSetRegardingSelectedRecord" Library="$webresource:new_MailAppScriptResource" InvertResult="true">
          <CrmParameter Value="SelectedControlSelectedItemReferences" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="MailApp.Rules.IsTrackAllowed">
        <CustomRule Default="false" FunctionName="IsTrackAllowed" Library="$webresource:new_MailAppScriptResource" />
      </EnableRule>
      <EnableRule Id="Mscrm.AssignPrimaryPermission">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Assign" />
      </EnableRule>
      <EnableRule Id="Mscrm.CanDeletePrimary">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Delete" />
      </EnableRule>
      <EnableRule Id="Mscrm.FormDesignValid">
        <CustomRule FunctionName="Mscrm.RibbonActions.isFormDesignValid" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="SelectedEntityTypeCode" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.IsBPFCommandsAvaialableOffline">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.IsBPFCommandsAvaialableOffline" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.CanSwitchProcess">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.CanSwitchProcess" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.CanEditProcess">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.CanEditProcess" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsBusinessProcessPresent">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.IsBusinessProcessPresent" Library="$webresource:Main_system_library.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShowAbandon">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.ShowAbandon" Library="$webresource:Main_system_library.js" Default="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShowReactivate">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.ShowReactivate" Library="$webresource:Main_system_library.js" Default="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShowFinish">
        <CustomRule FunctionName="Mscrm.WorkflowWebResource.ShowFinish" Library="$webresource:Main_system_library.js" Default="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.FormStateExistingOrReadOnlyOrDisabled">
        <OrRule>
          <Or>
            <FormStateRule State="ReadOnly" />
          </Or>
          <Or>
            <FormStateRule State="Existing" />
          </Or>
          <Or>
            <FormStateRule State="Disabled" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.AddPrimaryToMarketingList">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Append" />
        <CrmOfflineAccessStateRule State="Offline" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.FormStateExistingOrReadOnly">
        <OrRule>
          <Or>
            <FormStateRule State="ReadOnly" />
          </Or>
          <Or>
            <FormStateRule State="Existing" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.IsExportPdfDocumentSdkAvilable">
        <CustomRule FunctionName="Mscrm.AdminSettings.isPdfCommandEnabled" Library="$webresource:Sales/Settings/Sale_Admin_Settings.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ShouldShowCreateAndEmailPDFRibbonCommand">
        <CustomRule FunctionName="Sales.CommandBarActions.Instance.shouldShowCreateAndEmailPDFCommand" Library="$webresource:Sales/CommandBarActions/SalesCommandBarActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsCreateEmailWithEntityDocumentSdkAvilable">
        <CustomRule FunctionName="Mscrm.AdminSettings.isPdfCommandEnabled" Library="$webresource:Sales/Settings/Sale_Admin_Settings.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.SharePrimaryPermission">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Share" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShareSecuredFieldsPrimaryPermission">
        <CustomRule FunctionName="Mscrm.RibbonActions.hasSecuredFields" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.MainTab">
        <EntityRule AppliesTo="PrimaryEntity" EntityName="{!EntityLogicalName}" />
        <CustomRule FunctionName="Mscrm.RibbonActions.primaryControlIsNotFormProxy" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.AvailableOnForm">
        <EntityRule AppliesTo="PrimaryEntity" Default="false" Context="Form" />
      </EnableRule>
      <EnableRule Id="Mscrm.CanSavePrimary">
        <OrRule>
          <Or>
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Create" />
            <FormStateRule State="Create" />
          </Or>
          <Or>
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" />
            <FormStateRule State="Existing" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ReadPrimaryPermission">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Read" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsAutoSaveDisable">
        <OrRule>
          <Or>
            <FormStateRule State="Create" />
          </Or>
          <Or>
            <CustomRule FunctionName="XrmCore.Rules.AutoSave.isAutoSaveEnabled" Library="$webresource:Main_system_library.js" InvertResult="true" />
          </Or>
          <Or>
            <CustomRule FunctionName="XrmCore.Rules.RefreshForm.isRefreshForm" Library="$webresource:Main_system_library.js" InvertResult="true" />
          </Or>
          <Or>
            <CommandClientTypeRule Type="Modern" />
            <FeatureControlRule FeatureControlBit="FCB.AlwaysShowSaveAndSaveAndClose" ExpectedValue="true" />
            <FeatureControlRule FeatureControlBit="FCB.April2020Update" ExpectedValue="true" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.HideSaveOnMobile">
        <OrRule>
          <Or>
            <CustomRule FunctionName="XrmCore.Rules.Enabled.isReactNativeMobile" Library="$webresource:Main_system_library.js" InvertResult="true" />
          </Or>
          <Or>
            <CustomRule FunctionName="XrmCore.Rules.Enabled.isReactNativeFormEditModeShowCommandBarEnabled" Library="$webresource:Main_system_library.js" InvertResult="true" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.HideForSalesAccelerationShell">
        <CustomRule FunctionName="AcceleratedSales.RibbonCommands.displayRibbonWithinSAShell" Library="$webresource:msdyn_/AcceleratedSales.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.CanWritePrimary">
        <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" />
      </EnableRule>
      <EnableRule Id="Mscrm.ConvertActivity">
        <FormStateRule State="Create" InvertResult="true" />
        <FormStateRule State="Disabled" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsOpportunityAvailableInMocaOffline">
        <CustomRule Library="$webresource:Main_system_library.js" FunctionName="XrmCore.Rules.Online.IsEntityAvailableForUserInMocaOffline">
          <StringParameter Value="opportunity" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.EnablePromoteToResponse">
        <CustomRule FunctionName="Marketing.CommandActions.Instance.canPromoteActivityToResponse" Library="$webresource:Marketing/CommandActions/Marketing_CommandActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.QueueItemDetailEnableRule">
        <CustomRule FunctionName="OmniChannelPackage.CommandBarActions.Instance.shouldShowDefaultQueueItemDetail" Library="$webresource:msdyn_OmniChannelCommandBarActions.js" Default="true">
          <CrmParameter Value="FirstPrimaryItemId" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.IsFormHierarchyEnabled">
        <CustomRule FunctionName="XrmCore.Rules.Hierarchy.IsFormHierarchyEnabled" Library="$webresource:Main_system_library.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.ShareRecordsAndSecuredFieldsPrimaryPermission">
        <OrRule>
          <Or>
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Share" />
          </Or>
          <Or>
            <CustomRule FunctionName="Mscrm.RibbonActions.hasSecuredFields" Library="/_static/_common/scripts/RibbonActions.js" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.RunWorkflowPrimary">
        <CustomRule FunctionName="Mscrm.RibbonActions.enableWorkflowOnForm" Library="/_static/_common/scripts/RibbonActions.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.AppCommon.IsPdfEnabledForEntity">
        <CustomRule FunctionName="AppCommon.RibbonRules.isPdfCommandEnabled" Library="$webresource:AppCommon/CommandActions/AppCommon_CommandActions.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.CheckIfEntityContainsecureField">
        <CustomRule FunctionName="AppCommon.DialogActions.showShareSecuredFieldsButton" Default="false" Library="$webresource:AppCommon/ClientCommon/AppCommon_ClientCommon.js" />
      </EnableRule>
      <EnableRule Id="Mscrm.ShowSharedSecuredFieldButtonInUCI">
        <CustomRule FunctionName="AppCommon.DialogActions.showSecuredFieldButtonInUCI" Library="$webresource:AppCommon/ClientCommon/AppCommon_ClientCommon.js" Default="true" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsPlaybookTemplateAvailable">
        <CustomRule FunctionName="PlaybookService.CommandBarActions.isDisplayPlayBook" Library="$webresource:Playbook/CommandBarActions/Playbook_CommandBarActions_library.js">
          <CrmParameter Value="PrimaryEntityTypeName" />
          <CrmParameter Value="SelectedEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.NotNewEnableRule">
        <FormStateRule State="Create" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.IsFollowButtonEnabled">
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/Scripts/PlatformScriptLoader.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/InstalledLocales.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowEnabled.isFollowButtonEnabled">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <BoolParameter Value="true" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ActivityFeeds.IsUnFollowButtonEnabled">
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/Scripts/PlatformScriptLoader.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Library="$webresource:msdyn_/InstalledLocales.js" FunctionName="Follow.FollowCommands.dummy" />
        <CustomRule Default="false" Library="$webresource:msdyn_/Follow.Command.js" FunctionName="Follow.FollowEnabled.isFollowButtonEnabled">
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
          <BoolParameter Value="false" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="MailApp.Rules.IsRecordSaved">
        <CustomRule Default="false" FunctionName="IsRecordSaved" Library="$webresource:new_MailAppScriptResource" />
      </EnableRule>
      <EnableRule Id="MailApp.Rules.IsNotSetRegardingCurrentRecord">
        <CustomRule Default="false" FunctionName="IsSetRegardingCurrentRecord" Library="$webresource:new_MailAppScriptResource" InvertResult="true" />
      </EnableRule>
      <EnableRule Id="MailApp.Rules.IsMailApp">
        <CustomRule Default="false" FunctionName="HasMailContext" Library="$webresource:new_MailAppScriptResource" />
      </EnableRule>
      <EnableRule Id="Yammer.ShowYammer">
        <CustomRule FunctionName="Yammer.Rules.showYammer" Library="$webresource:msdyn_/YammerIntegration/Yammer_main_system_library.js" Default="false">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="OfficeProductivity.RibbonRules.showMSTeamsCollaborateCommand">
        <CustomRule FunctionName="OfficeProductivity.RibbonRules.showMSTeamsCollaborateCommand" Library="$webresource:msdyn_/OfficeProductivity_RibbonRules.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="OfficeProductivity.RibbonRules.hideCollaborateCommandForContextualEmail">
        <CustomRule FunctionName="OfficeProductivity.RibbonRules.hideCollaborateCommandForContextualEmail" Library="$webresource:msdyn_/OfficeProductivity_RibbonRules.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="msdyn.ApplicationRibbon.Form.BookResource.EnableRule">
        <FormStateRule State="Existing" />
        <CustomRule FunctionName="FpsUtils.Form.isBookButtonEnabled" Library="$webresource:msdyn_/fps/Utils/FpsUtils.js" Default="false">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.CanSaveAndRunRoutingRule">
        <OrRule>
          <Or>
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" />
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="AppendTo" />
            <FormStateRule State="Existing" />
          </Or>
          <Or>
            <FormStateRule State="Create" />
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Create" />
          </Or>
          <Or>
            <CustomRule FunctionName="XrmCore.Rules.AutoSave.isAutoSaveEnabled" Library="$webresource:Main_system_library.js" InvertResult="true" />
            <RecordPrivilegeRule AppliesTo="PrimaryEntity" PrivilegeType="Write" />
            <FormStateRule State="Existing" />
          </Or>
        </OrRule>
      </EnableRule>
      <EnableRule Id="Mscrm.QueueItemDetailOmnichannelEnableRule">
        <CustomRule FunctionName="OmniChannelPackage.CommandBarActions.Instance.shouldShowOmnichannelQueueItemDetail" Library="$webresource:msdyn_OmniChannelCommandBarActions.js" Default="false">
          <CrmParameter Value="FirstPrimaryItemId" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Sequence.IsTargetEntityActive">
        <ValueRule Value="0" Field="statecode" />
      </EnableRule>
      <EnableRule Id="Mscrm.IsEntityFormApplicableForCadence">
        <CustomRule FunctionName="Sales.SalesCadence.Instance.IsEntityFormApplicableForCadence" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="PrimaryControl" />
          <BoolParameter Value="true" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Sequence.Form.IsApplicableForDisconnect">
        <CustomRule FunctionName="Sales.SalesCadence.Instance.IsEntityFormApplicableForCadence" Library="$webresource:SalesCadence/SalesCadence/msdyn_SalesCadence.js">
          <CrmParameter Value="PrimaryControl" />
          <BoolParameter Value="false" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.FormStateExisting">
        <FormStateRule State="Existing" />
      </EnableRule>
      <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.Related">
        <EntityRule AppliesTo="PrimaryEntity" EntityName="{!EntityLogicalName}" />
        <CustomRule FunctionName="Mscrm.RibbonActions.primaryControlIsNotFormProxy" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
      <EnableRule Id="Mscrm.Form.{!EntityLogicalName}.Developer">
        <EntityRule AppliesTo="PrimaryEntity" EntityName="{!EntityLogicalName}" />
        <CustomRule FunctionName="Mscrm.RibbonActions.formPageDeveloperTabEnableRule" Library="/_static/_common/scripts/RibbonActions.js">
          <CrmParameter Value="PrimaryControl" />
        </CustomRule>
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
</RibbonDefinition>
</RibbonDefinitions>`;