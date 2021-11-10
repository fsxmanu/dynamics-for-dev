// To parse this data:
//
//   import { Convert, Welcome4 } from "./file";
//
//   const welcome4 = Convert.toWelcome4(json);
//
// These functions will throw an error if the JSON doesn't
// match the expected interface, even if the JSON is valid.

export interface Welcome4 {
    RibbonDefinitions: RibbonDefinitions;
}

export interface RibbonDefinitions {
    RibbonDefinition: RibbonDefinition;
}

export interface RibbonDefinition {
    UI:                 UI;
    Templates:          Templates;
    CommandDefinitions: CommandDefinitions;
    RuleDefinitions:    RuleDefinitions;
}

export interface CommandDefinitions {
    CommandDefinition: CommandDefinition[];
}

export interface CommandDefinition {
    EnableRules:  EnableRulesEnableRules | string;
    DisplayRules: DisplayRulesDisplayRules | string;
    Actions:      ActionsClass | string;
}

export interface ActionsClass {
    JavaScriptFunction: Array<PurpleJavaScriptFunction | string> | FluffyJavaScriptFunction | string;
}

export interface PurpleJavaScriptFunction {
    CrmParameter: string[] | string;
}

export interface FluffyJavaScriptFunction {
    CrmParameter?:    string[] | string;
    StringParameter?: string[] | string;
    BoolParameter?:   string;
    IntParameter?:    string[] | string;
}

export interface DisplayRulesDisplayRules {
    DisplayRule: string[] | string;
}

export interface EnableRulesEnableRules {
    EnableRule: string[] | string;
}

export interface RuleDefinitions {
    DisplayRules: RuleDefinitionsDisplayRules;
    EnableRules:  RuleDefinitionsEnableRules;
}

export interface RuleDefinitionsDisplayRules {
    DisplayRule: DisplayRuleElement[];
}

export interface DisplayRuleElement {
    CustomRule?:                       string;
    MiscellaneousPrivilegeRule?:       string;
    EntityPrivilegeRule?:              string[] | string;
    OrRule?:                           DisplayRuleOrRule;
    CommandClientTypeRule?:            string;
    CrmOfflineAccessStateRule?:        string;
    FeatureControlRule?:               string;
    RelationshipTypeRule?:             string;
    EntityPropertyRule?:               string;
    EntityRule?:                       string[] | string;
    FormEntityContextRule?:            string;
    OrganizationSettingRule?:          string;
    PageRule?:                         string[] | string;
    CrmClientTypeRule?:                string;
    HideForTabletExperienceRule?:      string;
    SkuRule?:                          string;
    DeviceTypeRule?:                   string;
    OutlookVersionRule?:               string;
    ReferencingAttributeRequiredRule?: string;
    FormStateRule?:                    string;
    OutlookRenderTypeRule?:            string;
}

export interface DisplayRuleOrRule {
    Or: PurpleOr[] | FluffyOr;
}

export interface PurpleOr {
    CommandClientTypeRule?:       string;
    FeatureControlRule?:          string[] | string;
    RelationshipTypeRule?:        string;
    EntityPrivilegeRule?:         string[] | string;
    EntityPropertyRule?:          string[] | string;
    MiscellaneousPrivilegeRule?:  string;
    EntityRule?:                  string;
    PageRule?:                    string[] | string;
    DeviceTypeRule?:              string;
    CrmClientTypeRule?:           string;
    FormEntityContextRule?:       string;
    ValueRule?:                   string;
    HideForTabletExperienceRule?: string;
    FormStateRule?:               string;
}

export interface FluffyOr {
    FeatureControlRule: string;
}

export interface RuleDefinitionsEnableRules {
    EnableRule: EnableRuleElement[];
}

export interface EnableRuleElement {
    CrmOfflineAccessStateRule?: string;
    SelectionCountRule?:        string;
    OrRule?:                    EnableRuleOrRule;
    CustomRule?:                Array<PurpleCustomRule | string> | FluffyCustomRule | string;
    EntityRule?:                string;
    FormStateRule?:             string[] | string;
    CommandClientTypeRule?:     string;
    PageRule?:                  string;
    RecordPrivilegeRule?:       string;
    ValueRule?:                 string;
}

export interface PurpleCustomRule {
    CrmParameter:  string[];
    BoolParameter: string;
}

export interface FluffyCustomRule {
    CrmParameter?:    string[] | string;
    BoolParameter?:   string;
    StringParameter?: string;
}

export interface EnableRuleOrRule {
    Or: OrRuleOrClass[];
}

export interface OrRuleOrClass {
    CommandClientTypeRule?: string;
    CustomRule?:            TentacledCustomRule | string;
    SelectionCountRule?:    string;
    CrmClientTypeRule?:     string;
    PageRule?:              string;
    FormStateRule?:         string;
    RecordPrivilegeRule?:   string[] | string;
    FeatureControlRule?:    string[];
}

export interface TentacledCustomRule {
    CrmParameter: string;
}

export interface Templates {
    RibbonTemplates: RibbonTemplates;
}

export interface RibbonTemplates {
    GroupTemplate: GroupTemplate[];
}

export interface GroupTemplate {
    Layout: Array<LayoutClass | string>;
}

export interface LayoutClass {
    OverflowSection: string[];
    Section?:        Section[];
}

export interface Section {
    Row: RowElement[] | RowElement;
}

export interface RowElement {
    ControlRef: string;
}

export interface UI {
    Ribbon: Ribbon;
}

export interface Ribbon {
    Tabs:           Tabs;
    ContextualTabs: ContextualTabs;
}

export interface ContextualTabs {
    ContextualGroup: ContextualGroup[];
}

export interface ContextualGroup {
    Tab: ContextualGroupTab;
}

export interface ContextualGroupTab {
    Scaling: Scaling;
    Groups:  PurpleGroups;
}

export interface PurpleGroups {
    Group: PurpleGroup[];
}

export interface PurpleGroup {
    Controls: GroupControlsClass;
}

export interface GroupControlsClass {
    Button:        string[] | string;
    FlyoutAnchor?: Array<SplitButton | string> | PurpleFlyoutAnchor | string;
    SplitButton?:  SplitButton;
    ToggleButton?: string;
}

export interface SplitButton {
    Menu: SplitButtonMenu;
}

export interface SplitButtonMenu {
    MenuSection: PurpleMenuSection;
}

export interface PurpleMenuSection {
    Controls: PurpleControls;
}

export interface PurpleControls {
    Button: string[];
}

export interface PurpleFlyoutAnchor {
    Menu: PurpleMenu;
}

export interface PurpleMenu {
    MenuSection: FluffyMenuSection;
}

export interface FluffyMenuSection {
    Controls: FluffyControls;
}

export interface FluffyControls {
    Button?:       string[];
    ToggleButton?: string[];
}

export interface Scaling {
    MaxSize: string[];
    Scale:   string[];
}

export interface Tabs {
    Tab: TabElement[];
}

export interface TabElement {
    Scaling: Scaling;
    Groups:  FluffyGroups;
}

export interface FluffyGroups {
    Group: FluffyGroup[];
}

export interface FluffyGroup {
    Controls: ControlsControls | string;
}

export interface ControlsControls {
    Button?:       string[] | string;
    SplitButton?:  SplitButton[] | SplitButton;
    FlyoutAnchor?: Array<FluffyFlyoutAnchor | string> | TentacledFlyoutAnchor | string;
    ToggleButton?: string;
}

export interface FluffyFlyoutAnchor {
    Menu: FluffyMenu;
}

export interface FluffyMenu {
    MenuSection: TentacledMenuSection;
}

export interface TentacledMenuSection {
    Controls: TentacledControls;
}

export interface TentacledControls {
    Button?:       string[] | string;
    FlyoutAnchor?: string[];
}

export interface TentacledFlyoutAnchor {
    Menu: TentacledMenu;
}

export interface TentacledMenu {
    MenuSection: StickyMenuSection;
}

export interface StickyMenuSection {
    Controls: StickyControls;
}

export interface StickyControls {
    ToggleButton?: string[];
    Button?:       string[] | string;
}

// Converts JSON strings to/from your types
// and asserts the results of JSON.parse at runtime
export class Convert {
    public static toWelcome4(json: string): Welcome4 {
        return cast(JSON.parse(json), r("Welcome4"));
    }

    public static welcome4ToJson(value: Welcome4): string {
        return JSON.stringify(uncast(value, r("Welcome4")), null, 2);
    }
}

function invalidValue(typ: any, val: any, key: any = ''): never {
    if (key) {
        throw Error(`Invalid value for key "${key}". Expected type ${JSON.stringify(typ)} but got ${JSON.stringify(val)}`);
    }
    throw Error(`Invalid value ${JSON.stringify(val)} for type ${JSON.stringify(typ)}`, );
}

function jsonToJSProps(typ: any): any {
    if (typ.jsonToJS === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.json] = { key: p.js, typ: p.typ });
        typ.jsonToJS = map;
    }
    return typ.jsonToJS;
}

function jsToJSONProps(typ: any): any {
    if (typ.jsToJSON === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.js] = { key: p.json, typ: p.typ });
        typ.jsToJSON = map;
    }
    return typ.jsToJSON;
}

function transform(val: any, typ: any, getProps: any, key: any = ''): any {
    function transformPrimitive(typ: string, val: any): any {
        if (typeof typ === typeof val) return val;
        return invalidValue(typ, val, key);
    }

    function transformUnion(typs: any[], val: any): any {
        // val must validate against one typ in typs
        const l = typs.length;
        for (let i = 0; i < l; i++) {
            const typ = typs[i];
            try {
                return transform(val, typ, getProps);
            } catch (_) {}
        }
        return invalidValue(typs, val);
    }

    function transformEnum(cases: string[], val: any): any {
        if (cases.indexOf(val) !== -1) return val;
        return invalidValue(cases, val);
    }

    function transformArray(typ: any, val: any): any {
        // val must be an array with no invalid elements
        if (!Array.isArray(val)) return invalidValue("array", val);
        return val.map(el => transform(el, typ, getProps));
    }

    function transformDate(val: any): any {
        if (val === null) {
            return null;
        }
        const d = new Date(val);
        if (isNaN(d.valueOf())) {
            return invalidValue("Date", val);
        }
        return d;
    }

    function transformObject(props: { [k: string]: any }, additional: any, val: any): any {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return invalidValue("object", val);
        }
        const result: any = {};
        Object.getOwnPropertyNames(props).forEach(key => {
            const prop = props[key];
            const v = Object.prototype.hasOwnProperty.call(val, key) ? val[key] : undefined;
            result[prop.key] = transform(v, prop.typ, getProps, prop.key);
        });
        Object.getOwnPropertyNames(val).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
                result[key] = transform(val[key], additional, getProps, key);
            }
        });
        return result;
    }

    if (typ === "any") return val;
    if (typ === null) {
        if (val === null) return val;
        return invalidValue(typ, val);
    }
    if (typ === false) return invalidValue(typ, val);
    while (typeof typ === "object" && typ.ref !== undefined) {
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) return transformEnum(typ, val);
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? transformUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? transformArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? transformObject(getProps(typ), typ.additional, val)
            : invalidValue(typ, val);
    }
    // Numbers can be parsed by Date but shouldn't be.
    if (typ === Date && typeof val !== "number") return transformDate(val);
    return transformPrimitive(typ, val);
}

function cast<T>(val: any, typ: any): T {
    return transform(val, typ, jsonToJSProps);
}

function uncast<T>(val: T, typ: any): any {
    return transform(val, typ, jsToJSONProps);
}

function a(typ: any) {
    return { arrayItems: typ };
}

function u(...typs: any[]) {
    return { unionMembers: typs };
}

function o(props: any[], additional: any) {
    return { props, additional };
}

function m(additional: any) {
    return { props: [], additional };
}

function r(name: string) {
    return { ref: name };
}

const typeMap: any = {
    "Welcome4": o([
        { json: "RibbonDefinitions", js: "RibbonDefinitions", typ: r("RibbonDefinitions") },
    ], false),
    "RibbonDefinitions": o([
        { json: "RibbonDefinition", js: "RibbonDefinition", typ: r("RibbonDefinition") },
    ], false),
    "RibbonDefinition": o([
        { json: "UI", js: "UI", typ: r("UI") },
        { json: "Templates", js: "Templates", typ: r("Templates") },
        { json: "CommandDefinitions", js: "CommandDefinitions", typ: r("CommandDefinitions") },
        { json: "RuleDefinitions", js: "RuleDefinitions", typ: r("RuleDefinitions") },
    ], false),
    "CommandDefinitions": o([
        { json: "CommandDefinition", js: "CommandDefinition", typ: a(r("CommandDefinition")) },
    ], false),
    "CommandDefinition": o([
        { json: "EnableRules", js: "EnableRules", typ: u(r("EnableRulesEnableRules"), "") },
        { json: "DisplayRules", js: "DisplayRules", typ: u(r("DisplayRulesDisplayRules"), "") },
        { json: "Actions", js: "Actions", typ: u(r("ActionsClass"), "") },
    ], false),
    "ActionsClass": o([
        { json: "JavaScriptFunction", js: "JavaScriptFunction", typ: u(a(u(r("PurpleJavaScriptFunction"), "")), r("FluffyJavaScriptFunction"), "") },
    ], false),
    "PurpleJavaScriptFunction": o([
        { json: "CrmParameter", js: "CrmParameter", typ: u(a(""), "") },
    ], false),
    "FluffyJavaScriptFunction": o([
        { json: "CrmParameter", js: "CrmParameter", typ: u(undefined, u(a(""), "")) },
        { json: "StringParameter", js: "StringParameter", typ: u(undefined, u(a(""), "")) },
        { json: "BoolParameter", js: "BoolParameter", typ: u(undefined, "") },
        { json: "IntParameter", js: "IntParameter", typ: u(undefined, u(a(""), "")) },
    ], false),
    "DisplayRulesDisplayRules": o([
        { json: "DisplayRule", js: "DisplayRule", typ: u(a(""), "") },
    ], false),
    "EnableRulesEnableRules": o([
        { json: "EnableRule", js: "EnableRule", typ: u(a(""), "") },
    ], false),
    "RuleDefinitions": o([
        { json: "DisplayRules", js: "DisplayRules", typ: r("RuleDefinitionsDisplayRules") },
        { json: "EnableRules", js: "EnableRules", typ: r("RuleDefinitionsEnableRules") },
    ], false),
    "RuleDefinitionsDisplayRules": o([
        { json: "DisplayRule", js: "DisplayRule", typ: a(r("DisplayRuleElement")) },
    ], false),
    "DisplayRuleElement": o([
        { json: "CustomRule", js: "CustomRule", typ: u(undefined, "") },
        { json: "MiscellaneousPrivilegeRule", js: "MiscellaneousPrivilegeRule", typ: u(undefined, "") },
        { json: "EntityPrivilegeRule", js: "EntityPrivilegeRule", typ: u(undefined, u(a(""), "")) },
        { json: "OrRule", js: "OrRule", typ: u(undefined, r("DisplayRuleOrRule")) },
        { json: "CommandClientTypeRule", js: "CommandClientTypeRule", typ: u(undefined, "") },
        { json: "CrmOfflineAccessStateRule", js: "CrmOfflineAccessStateRule", typ: u(undefined, "") },
        { json: "FeatureControlRule", js: "FeatureControlRule", typ: u(undefined, "") },
        { json: "RelationshipTypeRule", js: "RelationshipTypeRule", typ: u(undefined, "") },
        { json: "EntityPropertyRule", js: "EntityPropertyRule", typ: u(undefined, "") },
        { json: "EntityRule", js: "EntityRule", typ: u(undefined, u(a(""), "")) },
        { json: "FormEntityContextRule", js: "FormEntityContextRule", typ: u(undefined, "") },
        { json: "OrganizationSettingRule", js: "OrganizationSettingRule", typ: u(undefined, "") },
        { json: "PageRule", js: "PageRule", typ: u(undefined, u(a(""), "")) },
        { json: "CrmClientTypeRule", js: "CrmClientTypeRule", typ: u(undefined, "") },
        { json: "HideForTabletExperienceRule", js: "HideForTabletExperienceRule", typ: u(undefined, "") },
        { json: "SkuRule", js: "SkuRule", typ: u(undefined, "") },
        { json: "DeviceTypeRule", js: "DeviceTypeRule", typ: u(undefined, "") },
        { json: "OutlookVersionRule", js: "OutlookVersionRule", typ: u(undefined, "") },
        { json: "ReferencingAttributeRequiredRule", js: "ReferencingAttributeRequiredRule", typ: u(undefined, "") },
        { json: "FormStateRule", js: "FormStateRule", typ: u(undefined, "") },
        { json: "OutlookRenderTypeRule", js: "OutlookRenderTypeRule", typ: u(undefined, "") },
    ], false),
    "DisplayRuleOrRule": o([
        { json: "Or", js: "Or", typ: u(a(r("PurpleOr")), r("FluffyOr")) },
    ], false),
    "PurpleOr": o([
        { json: "CommandClientTypeRule", js: "CommandClientTypeRule", typ: u(undefined, "") },
        { json: "FeatureControlRule", js: "FeatureControlRule", typ: u(undefined, u(a(""), "")) },
        { json: "RelationshipTypeRule", js: "RelationshipTypeRule", typ: u(undefined, "") },
        { json: "EntityPrivilegeRule", js: "EntityPrivilegeRule", typ: u(undefined, u(a(""), "")) },
        { json: "EntityPropertyRule", js: "EntityPropertyRule", typ: u(undefined, u(a(""), "")) },
        { json: "MiscellaneousPrivilegeRule", js: "MiscellaneousPrivilegeRule", typ: u(undefined, "") },
        { json: "EntityRule", js: "EntityRule", typ: u(undefined, "") },
        { json: "PageRule", js: "PageRule", typ: u(undefined, u(a(""), "")) },
        { json: "DeviceTypeRule", js: "DeviceTypeRule", typ: u(undefined, "") },
        { json: "CrmClientTypeRule", js: "CrmClientTypeRule", typ: u(undefined, "") },
        { json: "FormEntityContextRule", js: "FormEntityContextRule", typ: u(undefined, "") },
        { json: "ValueRule", js: "ValueRule", typ: u(undefined, "") },
        { json: "HideForTabletExperienceRule", js: "HideForTabletExperienceRule", typ: u(undefined, "") },
        { json: "FormStateRule", js: "FormStateRule", typ: u(undefined, "") },
    ], false),
    "FluffyOr": o([
        { json: "FeatureControlRule", js: "FeatureControlRule", typ: "" },
    ], false),
    "RuleDefinitionsEnableRules": o([
        { json: "EnableRule", js: "EnableRule", typ: a(r("EnableRuleElement")) },
    ], false),
    "EnableRuleElement": o([
        { json: "CrmOfflineAccessStateRule", js: "CrmOfflineAccessStateRule", typ: u(undefined, "") },
        { json: "SelectionCountRule", js: "SelectionCountRule", typ: u(undefined, "") },
        { json: "OrRule", js: "OrRule", typ: u(undefined, r("EnableRuleOrRule")) },
        { json: "CustomRule", js: "CustomRule", typ: u(undefined, u(a(u(r("PurpleCustomRule"), "")), r("FluffyCustomRule"), "")) },
        { json: "EntityRule", js: "EntityRule", typ: u(undefined, "") },
        { json: "FormStateRule", js: "FormStateRule", typ: u(undefined, u(a(""), "")) },
        { json: "CommandClientTypeRule", js: "CommandClientTypeRule", typ: u(undefined, "") },
        { json: "PageRule", js: "PageRule", typ: u(undefined, "") },
        { json: "RecordPrivilegeRule", js: "RecordPrivilegeRule", typ: u(undefined, "") },
        { json: "ValueRule", js: "ValueRule", typ: u(undefined, "") },
    ], false),
    "PurpleCustomRule": o([
        { json: "CrmParameter", js: "CrmParameter", typ: a("") },
        { json: "BoolParameter", js: "BoolParameter", typ: "" },
    ], false),
    "FluffyCustomRule": o([
        { json: "CrmParameter", js: "CrmParameter", typ: u(undefined, u(a(""), "")) },
        { json: "BoolParameter", js: "BoolParameter", typ: u(undefined, "") },
        { json: "StringParameter", js: "StringParameter", typ: u(undefined, "") },
    ], false),
    "EnableRuleOrRule": o([
        { json: "Or", js: "Or", typ: a(r("OrRuleOrClass")) },
    ], false),
    "OrRuleOrClass": o([
        { json: "CommandClientTypeRule", js: "CommandClientTypeRule", typ: u(undefined, "") },
        { json: "CustomRule", js: "CustomRule", typ: u(undefined, u(r("TentacledCustomRule"), "")) },
        { json: "SelectionCountRule", js: "SelectionCountRule", typ: u(undefined, "") },
        { json: "CrmClientTypeRule", js: "CrmClientTypeRule", typ: u(undefined, "") },
        { json: "PageRule", js: "PageRule", typ: u(undefined, "") },
        { json: "FormStateRule", js: "FormStateRule", typ: u(undefined, "") },
        { json: "RecordPrivilegeRule", js: "RecordPrivilegeRule", typ: u(undefined, u(a(""), "")) },
        { json: "FeatureControlRule", js: "FeatureControlRule", typ: u(undefined, a("")) },
    ], false),
    "TentacledCustomRule": o([
        { json: "CrmParameter", js: "CrmParameter", typ: "" },
    ], false),
    "Templates": o([
        { json: "RibbonTemplates", js: "RibbonTemplates", typ: r("RibbonTemplates") },
    ], false),
    "RibbonTemplates": o([
        { json: "GroupTemplate", js: "GroupTemplate", typ: a(r("GroupTemplate")) },
    ], false),
    "GroupTemplate": o([
        { json: "Layout", js: "Layout", typ: a(u(r("LayoutClass"), "")) },
    ], false),
    "LayoutClass": o([
        { json: "OverflowSection", js: "OverflowSection", typ: a("") },
        { json: "Section", js: "Section", typ: u(undefined, a(r("Section"))) },
    ], false),
    "Section": o([
        { json: "Row", js: "Row", typ: u(a(r("RowElement")), r("RowElement")) },
    ], false),
    "RowElement": o([
        { json: "ControlRef", js: "ControlRef", typ: "" },
    ], false),
    "UI": o([
        { json: "Ribbon", js: "Ribbon", typ: r("Ribbon") },
    ], false),
    "Ribbon": o([
        { json: "Tabs", js: "Tabs", typ: r("Tabs") },
        { json: "ContextualTabs", js: "ContextualTabs", typ: r("ContextualTabs") },
    ], false),
    "ContextualTabs": o([
        { json: "ContextualGroup", js: "ContextualGroup", typ: a(r("ContextualGroup")) },
    ], false),
    "ContextualGroup": o([
        { json: "Tab", js: "Tab", typ: r("ContextualGroupTab") },
    ], false),
    "ContextualGroupTab": o([
        { json: "Scaling", js: "Scaling", typ: r("Scaling") },
        { json: "Groups", js: "Groups", typ: r("PurpleGroups") },
    ], false),
    "PurpleGroups": o([
        { json: "Group", js: "Group", typ: a(r("PurpleGroup")) },
    ], false),
    "PurpleGroup": o([
        { json: "Controls", js: "Controls", typ: r("GroupControlsClass") },
    ], false),
    "GroupControlsClass": o([
        { json: "Button", js: "Button", typ: u(a(""), "") },
        { json: "FlyoutAnchor", js: "FlyoutAnchor", typ: u(undefined, u(a(u(r("SplitButton"), "")), r("PurpleFlyoutAnchor"), "")) },
        { json: "SplitButton", js: "SplitButton", typ: u(undefined, r("SplitButton")) },
        { json: "ToggleButton", js: "ToggleButton", typ: u(undefined, "") },
    ], false),
    "SplitButton": o([
        { json: "Menu", js: "Menu", typ: r("SplitButtonMenu") },
    ], false),
    "SplitButtonMenu": o([
        { json: "MenuSection", js: "MenuSection", typ: r("PurpleMenuSection") },
    ], false),
    "PurpleMenuSection": o([
        { json: "Controls", js: "Controls", typ: r("PurpleControls") },
    ], false),
    "PurpleControls": o([
        { json: "Button", js: "Button", typ: a("") },
    ], false),
    "PurpleFlyoutAnchor": o([
        { json: "Menu", js: "Menu", typ: r("PurpleMenu") },
    ], false),
    "PurpleMenu": o([
        { json: "MenuSection", js: "MenuSection", typ: r("FluffyMenuSection") },
    ], false),
    "FluffyMenuSection": o([
        { json: "Controls", js: "Controls", typ: r("FluffyControls") },
    ], false),
    "FluffyControls": o([
        { json: "Button", js: "Button", typ: u(undefined, a("")) },
        { json: "ToggleButton", js: "ToggleButton", typ: u(undefined, a("")) },
    ], false),
    "Scaling": o([
        { json: "MaxSize", js: "MaxSize", typ: a("") },
        { json: "Scale", js: "Scale", typ: a("") },
    ], false),
    "Tabs": o([
        { json: "Tab", js: "Tab", typ: a(r("TabElement")) },
    ], false),
    "TabElement": o([
        { json: "Scaling", js: "Scaling", typ: r("Scaling") },
        { json: "Groups", js: "Groups", typ: r("FluffyGroups") },
    ], false),
    "FluffyGroups": o([
        { json: "Group", js: "Group", typ: a(r("FluffyGroup")) },
    ], false),
    "FluffyGroup": o([
        { json: "Controls", js: "Controls", typ: u(r("ControlsControls"), "") },
    ], false),
    "ControlsControls": o([
        { json: "Button", js: "Button", typ: u(undefined, u(a(""), "")) },
        { json: "SplitButton", js: "SplitButton", typ: u(undefined, u(a(r("SplitButton")), r("SplitButton"))) },
        { json: "FlyoutAnchor", js: "FlyoutAnchor", typ: u(undefined, u(a(u(r("FluffyFlyoutAnchor"), "")), r("TentacledFlyoutAnchor"), "")) },
        { json: "ToggleButton", js: "ToggleButton", typ: u(undefined, "") },
    ], false),
    "FluffyFlyoutAnchor": o([
        { json: "Menu", js: "Menu", typ: r("FluffyMenu") },
    ], false),
    "FluffyMenu": o([
        { json: "MenuSection", js: "MenuSection", typ: r("TentacledMenuSection") },
    ], false),
    "TentacledMenuSection": o([
        { json: "Controls", js: "Controls", typ: r("TentacledControls") },
    ], false),
    "TentacledControls": o([
        { json: "Button", js: "Button", typ: u(undefined, u(a(""), "")) },
        { json: "FlyoutAnchor", js: "FlyoutAnchor", typ: u(undefined, a("")) },
    ], false),
    "TentacledFlyoutAnchor": o([
        { json: "Menu", js: "Menu", typ: r("TentacledMenu") },
    ], false),
    "TentacledMenu": o([
        { json: "MenuSection", js: "MenuSection", typ: r("StickyMenuSection") },
    ], false),
    "StickyMenuSection": o([
        { json: "Controls", js: "Controls", typ: r("StickyControls") },
    ], false),
    "StickyControls": o([
        { json: "ToggleButton", js: "ToggleButton", typ: u(undefined, a("")) },
        { json: "Button", js: "Button", typ: u(undefined, u(a(""), "")) },
    ], false),
};
