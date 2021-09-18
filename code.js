var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
if (figma.editorType === 'figma') {
    figma.showUI(__html__, {
        width: 340,
        height: 180
    });
    figma.ui.onmessage = msg => {
        if (msg.type === 'create-columns') {
            const colCount = msg.columnCount;
            const colWidth = msg.columnWidth;
            const colGutter = msg.columnGutter;
            const elem = figma.currentPage.selection[0];
            var textStyleId;
            var result = '';
            // get any text styles - note that this will only work if one text style is used in the selection
            for (const node of figma.currentPage.selection) {
                if ("textStyleId" in node) {
                    textStyleId = node.textStyleId;
                }
            }
            //check if selection is a text node
            if (figma.currentPage.selection.length > 0 && elem.type === 'TEXT') {
                const text = elem.characters;
                const splitIndex = Math.round(text.length / colCount);
                const textArray = [];
                for (let i = 1; i <= colCount; i++) {
                    //regex is used to capture the string without slicing words
                    const pattern = '^(.|\\n|\\r){' + splitIndex + '}[^\\s]*';
                    var re = new RegExp(pattern, "g");
                    //since the string length will change dynamically with each iteration, we have to perform a series of checks on the first and last iteration
                    var string = (i === 1) ? text.match(re)[0]
                        : (i === colCount) ? result
                            : result.match(re)[0];
                    if (string) {
                        // add string to our array while trimming any leading or trailing white space
                        textArray.push(string.trim());
                        //update the text to account for the current iteration
                        var newResult = result;
                        result = '';
                        result += (i !== 1) ? newResult.substring(string.length, text.length) : text.substring(string.length, text.length);
                    }
                }
                // create a frame for our columns then add autolayout magic
                const columns = figma.createFrame();
                columns.layoutMode = "HORIZONTAL";
                columns.itemSpacing = colGutter;
                columns.clipsContent = false;
                // columns.resizeWithoutConstraints(300,300)
                columns.fills = [{ visible: false, type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
                columns.x = elem.x + elem.width + 100;
                columns.y = elem.y;
                figma.currentPage.appendChild(columns);
                function createTextbox() {
                    return __awaiter(this, void 0, void 0, function* () {
                        yield figma.loadFontAsync({ family: "Roboto", style: "Regular" });
                        // finally, we can loop through our array we made earlier and create text nodes for each of them
                        for (let i = 0; i < textArray.length; i++) {
                            const textbox = figma.createText();
                            textbox.characters = textArray[i];
                            textbox.resize(colWidth, 500);
                            textbox.textAutoResize = "HEIGHT";
                            textbox.textStyleId = (typeof textStyleId === 'string') ? textStyleId : '';
                            columns.appendChild(textbox);
                        }
                    });
                }
                //select and focus on the columns
                createTextbox().then(() => {
                    figma.viewport.scrollAndZoomIntoView([columns]);
                    figma.viewport.zoom = 0.8;
                    figma.currentPage.selection = [columns];
                });
            }
        }
    };
}
