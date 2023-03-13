// if (figma.editorType === 'figma' || figma.editorType === 'figjam') {
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
figma.showUI(__html__, {
    width: 340,
    height: 253
});
function clone(val) {
    const type = typeof val;
    if (val === null) {
        return null;
    }
    else if (type === 'undefined' || type === 'number' ||
        type === 'string' || type === 'boolean') {
        return val;
    }
    else if (type === 'object') {
        if (val instanceof Array) {
            return val.map(x => clone(x));
        }
        else if (val instanceof Uint8Array) {
            return new Uint8Array(val);
        }
        else {
            let o = {};
            for (const key in val) {
                o[key] = clone(val[key]);
            }
            return o;
        }
    }
    throw 'unknown';
}
figma.ui.onmessage = msg => {
    if (msg.type === 'create-columns') {
        const colCount = msg.columnCount;
        const colWidth = msg.columnWidth;
        const colGutter = msg.columnGutter;
        const colPriority = msg.priority;
        const removeLinebreaks = msg.removeLinebreaks;
        const elem = figma.currentPage.selection[0];
        ;
        var result = '';
        // get any text styles - note that this will only work if one text style is used in the selection
        if (figma.currentPage.selection.length > 0 && figma.currentPage.selection[0].type === 'TEXT') {
            for (const node of figma.currentPage.selection) {
                if ("textStyleId" in node) {
                    var textStyleId = node.textStyleId;
                }
                if ("fillStyleId" in node) {
                    var fillStyleId = node.fillStyleId;
                }
                if ("fills" in node) {
                    var blendMode = node.fills[0].blendMode, opacity = node.fills[0].opacity;
                    ;
                    if (node.fills[0].type === "SOLID") {
                        var colorR = node.fills[0].color.r, colorG = node.fills[0].color.g, colorB = node.fills[0].color.b;
                    }
                    else {
                        var colorR = 0, colorG = 0, colorB = 0;
                    }
                }
                if ("lineHeight" in node) {
                    if (node.lineHeight !== figma.mixed && node.lineHeight.unit === 'PERCENT') {
                        var lineHeightunit = node.lineHeight.unit, lineHeightvalue = node.lineHeight.value;
                    }
                    else if (node.lineHeight === 'AUTO') {
                        var lineHeightunit = node.lineHeight.unit;
                    }
                    else {
                        lineHeightunit = "PERCENT",
                            lineHeightvalue = 130;
                    }
                }
                if ("letterSpacing" in node) {
                    if (node.fontSize !== figma.mixed || node.fontName !== figma.mixed) {
                        var letterSpacingunit = node.letterSpacing.unit, letterSpacingvalue = node.letterSpacing.value;
                    }
                    else {
                        letterSpacingunit = "PERCENT",
                            letterSpacingvalue = 0;
                    }
                }
                if ("fontName" in node) {
                    if (node.fontName !== figma.mixed) {
                        var fontName = node.fontName.family;
                        var fontStyle = node.fontName.style;
                    }
                    else {
                        fontName = "Inter";
                        fontStyle = "Regular";
                    }
                }
                if ("fontSize" in node) {
                    if (node.fontSize !== figma.mixed) {
                        var fontSize = node.fontSize;
                    }
                    else {
                        fontSize = 12;
                    }
                }
                if ("fontWeight" in node) {
                    var fontWeight = node.fontWeight;
                }
                if ("paragraphSpacing" in node) {
                    var paragraphSpacing = node.paragraphSpacing;
                }
                var textProps = {
                    textStyleId: textStyleId,
                    fillStyleId: fillStyleId,
                    fillProperties: {
                        blendMode: blendMode,
                        opacity: opacity,
                        colorR: colorR,
                        colorG: colorG,
                        colorB: colorB,
                    },
                    textProperties: {
                        fontName: fontName,
                        fontStyle: fontStyle,
                        fontSize: fontSize,
                        fontWeight: fontWeight,
                        paragraphSpacing: paragraphSpacing,
                        letterSpacing: {
                            unit: letterSpacingunit,
                            value: letterSpacingvalue
                        },
                        lineHeight: {
                            unit: lineHeightunit,
                            value: lineHeightvalue
                        }
                    }
                };
            }
        }
        else {
            figma.notify('❌ Please select a textbox ❌', { timeout: 3000 });
        }
        //check if selection is a text node
        if (figma.currentPage.selection.length > 0 && elem.type === 'TEXT') {
            var text = elem.characters;
            const textArray = [];
            function removeWeirdChars() {
                return __awaiter(this, void 0, void 0, function* () {
                    // this function is for removing any weird invisible chars in the string that Figma returns
                    // if you encounter any other weird chars/zero width chars please submit an issue so I can update the regex
                    let re = new RegExp('\\u2028|\\u2029', 'g'), textString = text;
                    textString.replace(re, '');
                    //remove line breaks if chosen in the UI
                    console.log(msg.removeLinebreaks);
                    if (removeLinebreaks) {
                        let lineBreaksre = new RegExp('(\\r\\n|\\r|\\n){2,}', 'g');
                        textString = textString.replace(lineBreaksre, '\n');
                    }
                    return textString;
                });
            }
            removeWeirdChars().then(function (value) {
                const splitIndex = Math.round(value.length / colCount);
                //regex is used to capture the string without slicing words
                const pattern = (colPriority === 'paragraphs') ? '(.|\\n|\\r){1,' + splitIndex + '}[^\\s]*.*'
                    : (colPriority === 'evenness') ? '(.|\\n|\\r){1,' + splitIndex + '}[^\\s]*'
                        : '^(.|\\n|\\r){' + splitIndex + '}[^\\s]*';
                var re = new RegExp(pattern, 'g');
                if (value.match(re) !== null) {
                    for (let i = 1; i <= colCount; i++) {
                        var string = (i === 1) ? value.match(re)[0]
                            : (i === colCount) ? result
                                : result.match(re)[0];
                        if (string) {
                            // add string to our array while trimming any leading or trailing white space
                            textArray.push(string.trim());
                            //update the text to account for the current iteration
                            var newResult = result;
                            result = '';
                            result += (i !== 1) ? newResult.substring(string.length, value.length) : value.substring(string.length, value.length);
                        }
                    }
                }
                else {
                    figma.notify('❌ There may be invisible characters in your text. Please visit the plugin page / github for more info. ❌', { timeout: 3000 });
                }
            });
            // create a frame for our columns then add autolayout magic
            const columns = figma.createFrame();
            columns.layoutMode = "HORIZONTAL";
            columns.itemSpacing = colGutter;
            columns.clipsContent = false;
            // columns.resizeWithoutConstraints(300,300)
            columns.fills = [{ visible: false, type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
            if (figma.editorType === 'figjam') {
                columns.x = elem.x + elem.width + 100;
                columns.y = elem.y;
                figma.currentPage.appendChild(columns);
            }
            else {
                columns.x = 0;
                columns.y = 0;
                elem.parent.appendChild(columns);
            }
            function createTextbox() {
                return __awaiter(this, void 0, void 0, function* () {
                    //default font styles for Figma
                    yield figma.loadFontAsync({ family: "Roboto", style: "Regular" });
                    yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
                    //for figjam
                    yield figma.loadFontAsync({ family: "Inter", style: "Medium" });
                    yield figma.loadFontAsync({ family: textProps.textProperties.fontName, style: textProps.textProperties.fontStyle });
                    // finally, we can loop through our array we made earlier and create text nodes for each of them
                    for (let i = 0; i < textArray.length; i++) {
                        const textbox = figma.createText();
                        textbox.characters = textArray[i];
                        textbox.resize(colWidth, 500);
                        textbox.textAutoResize = "HEIGHT";
                        textbox.paragraphSpacing = textProps.textProperties.paragraphSpacing;
                        // textbox.fontWeight = textProps.textProperties.fontWeight;
                        // textbox.fills[0].blendMode = (typeof textProps.fillProperties.blendMode === 'string') ? textProps.fillProperties.blendMode : '';
                        const fills = clone(textbox.fills);
                        fills[0].blendMode = textProps.fillProperties.blendMode;
                        fills[0].opacity = textProps.fillProperties.opacity;
                        fills[0].color.r = textProps.fillProperties.colorR;
                        fills[0].color.g = textProps.fillProperties.colorG;
                        fills[0].color.b = textProps.fillProperties.colorB;
                        textbox.fills = fills;
                        const fontName = clone(textbox.fontName);
                        fontName.family = textProps.textProperties.fontName;
                        fontName.style = textProps.textProperties.fontStyle;
                        textbox.fontName = fontName;
                        let fontSizeVal = clone(textbox.fontSize);
                        fontSizeVal = textProps.textProperties.fontSize;
                        textbox.fontSize = fontSizeVal;
                        let lineHeight = clone(textbox.lineHeight);
                        lineHeight.unit = textProps.textProperties.lineHeight.unit;
                        if (textProps.textProperties.lineHeight.value) {
                            lineHeight.value = textProps.textProperties.lineHeight.value;
                        }
                        textbox.lineHeight = lineHeight;
                        let letterSpacing = clone(textbox.letterSpacing);
                        letterSpacing.unit = textProps.textProperties.letterSpacing.unit;
                        letterSpacing.value = textProps.textProperties.letterSpacing.value;
                        textbox.letterSpacing = letterSpacing;
                        textbox.textStyleId = (typeof textProps.textStyleId === 'string') ? textProps.textStyleId : '';
                        textbox.fillStyleId = (typeof textProps.fillStyleId === 'string') ? textProps.fillStyleId : '';
                        columns.appendChild(textbox);
                    }
                });
            }
            //select and focus on the columns
            createTextbox().then(() => {
                var x = figma.currentPage.selection[0].x;
                var y = figma.currentPage.selection[0].y;
                var width = figma.currentPage.selection[0].width;
                columns.x = (x + width + 50);
                columns.y = y;
                figma.viewport.scrollAndZoomIntoView([columns]);
                figma.viewport.zoom = 0.5;
                figma.currentPage.selection = [columns];
            });
        }
        else {
            figma.notify('❌ Please select a textbox to create columns ❌', { timeout: 3000 });
        }
    }
};
