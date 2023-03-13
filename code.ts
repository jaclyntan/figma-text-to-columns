

// if (figma.editorType === 'figma' || figma.editorType === 'figjam') {

figma.showUI(__html__, {
  width: 340,
  height: 253
});

function clone(val) {
  const type = typeof val
  if (val === null) {
    return null
  } else if (type === 'undefined' || type === 'number' ||
    type === 'string' || type === 'boolean') {
    return val
  } else if (type === 'object') {
    if (val instanceof Array) {
      return val.map(x => clone(x))
    } else if (val instanceof Uint8Array) {
      return new Uint8Array(val)
    } else {
      let o = {}
      for (const key in val) {
        o[key] = clone(val[key])
      }
      return o
    }
  }
  throw 'unknown'
}

figma.ui.onmessage = msg => {

  if (msg.type === 'create-columns') {
    const colCount = msg.columnCount;
    const colWidth = msg.columnWidth;
    const colGutter = msg.columnGutter;
    const colPriority = msg.priority;
    const removeLinebreaks = msg.removeLinebreaks;
    const elem = figma.currentPage.selection[0];

    interface textProps {
      textStyleId: any,
      fillStyleId: any,
      fillProperties: object,
      textProperties: object
    };

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
          var blendMode = node.fills[0].blendMode,
            opacity = node.fills[0].opacity;;

          if (node.fills[0].type === "SOLID") {
            var
              colorR = node.fills[0].color.r,
              colorG = node.fills[0].color.g,
              colorB = node.fills[0].color.b;
          } else {
            var
              colorR = 0,
              colorG = 0,
              colorB = 0;
          }
        }

        if ("lineHeight" in node) {
          if ((node as any).lineHeight !== figma.mixed && (node as any).lineHeight.unit === 'PERCENT') {
            var lineHeightunit = (node as any).lineHeight.unit,
              lineHeightvalue = (node as any).lineHeight.value;
          }
          else if ((node as any).lineHeight === 'AUTO') {
            var lineHeightunit = (node as any).lineHeight.unit;
          }
          else {
            lineHeightunit = "PERCENT",
              lineHeightvalue = 130;
          }
        }

        if ("letterSpacing" in node) {
          if ((node as any).fontSize !== figma.mixed || (node as any).fontName !== figma.mixed) {
            var letterSpacingunit = (node as any).letterSpacing.unit,
              letterSpacingvalue = (node as any).letterSpacing.value;
          } else {
            letterSpacingunit = "PERCENT",
              letterSpacingvalue = 0;
          }
        }

        if ("fontName" in node) {
          if ((node as any).fontName !== figma.mixed) {
            var fontName = (node as any).fontName.family;
            var fontStyle = (node as any).fontName.style;
          } else {
            fontName = "Inter";
            fontStyle = "Regular";
          }
        }

        if ("fontSize" in node) {
          if ((node as any).fontSize !== figma.mixed) {
            var fontSize = (node as any).fontSize;
          } else {
            fontSize = 12
          }
        }

        if ("fontWeight" in node) {
          var fontWeight = (node as any).fontWeight;
        }

        if ("paragraphSpacing" in node) {
          var paragraphSpacing = (node as any).paragraphSpacing;
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
        }
      }
    } else {
      figma.notify('❌ Please select a textbox ❌', { timeout: 3000 })
    }

    //check if selection is a text node
    if (figma.currentPage.selection.length > 0 && elem.type === 'TEXT') {

      var text = elem.characters;
      const textArray = [];

      async function removeWeirdChars() {
        // this function is for removing any weird invisible chars in the string that Figma returns
        // if you encounter any other weird chars/zero width chars please submit an issue so I can update the regex
        let re = new RegExp('\\u2028|\\u2029', 'g'),
          textString = text;
        textString.replace(re, '');

        //remove line breaks if chosen in the UI
        console.log(msg.removeLinebreaks)
        if (removeLinebreaks) {
          let lineBreaksre = new RegExp('(\\r\\n|\\r|\\n){2,}', 'g');
          textString = textString.replace(lineBreaksre, '\n');
        }

        return textString

      }

      removeWeirdChars().then(function (value) {

        const splitIndex = Math.round(value.length / colCount)

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
        } else {
          figma.notify('❌ There may be invisible characters in your text. Please visit the plugin page / github for more info. ❌', { timeout: 3000 })
        }

      })


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
      } else {
        columns.x = 0;
        columns.y = 0;
        elem.parent.appendChild(columns);
      }

      async function createTextbox() {

        //default font styles for Figma
        await figma.loadFontAsync({ family: "Roboto", style: "Regular" })
        await figma.loadFontAsync({ family: "Inter", style: "Regular" })

        //for figjam
        await figma.loadFontAsync({ family: "Inter", style: "Medium" })

        await figma.loadFontAsync({ family: textProps.textProperties.fontName, style: textProps.textProperties.fontStyle })

        // finally, we can loop through our array we made earlier and create text nodes for each of them
        for (let i = 0; i < textArray.length; i++) {

          const textbox = figma.createText();
          textbox.characters = textArray[i];
          textbox.resize(colWidth, 500);
          textbox.textAutoResize = "HEIGHT";
          textbox.paragraphSpacing = textProps.textProperties.paragraphSpacing;
          // textbox.fontWeight = textProps.textProperties.fontWeight;
          // textbox.fills[0].blendMode = (typeof textProps.fillProperties.blendMode === 'string') ? textProps.fillProperties.blendMode : '';

          const fills = clone(textbox.fills)
          fills[0].blendMode = textProps.fillProperties.blendMode;
          fills[0].opacity = textProps.fillProperties.opacity;
          fills[0].color.r = textProps.fillProperties.colorR;
          fills[0].color.g = textProps.fillProperties.colorG;
          fills[0].color.b = textProps.fillProperties.colorB;
          textbox.fills = fills

          const fontName = clone(textbox.fontName)
          fontName.family = textProps.textProperties.fontName;
          fontName.style = textProps.textProperties.fontStyle;
          textbox.fontName = fontName

          let fontSizeVal = clone(textbox.fontSize)
          fontSizeVal = textProps.textProperties.fontSize;
          textbox.fontSize = fontSizeVal

          let lineHeight = clone(textbox.lineHeight)
          lineHeight.unit = textProps.textProperties.lineHeight.unit;
          if (textProps.textProperties.lineHeight.value) {
            lineHeight.value = textProps.textProperties.lineHeight.value;
          }
          textbox.lineHeight = lineHeight

          let letterSpacing = clone(textbox.letterSpacing)
          letterSpacing.unit = textProps.textProperties.letterSpacing.unit;
          letterSpacing.value = textProps.textProperties.letterSpacing.value;
          textbox.letterSpacing = letterSpacing

          textbox.textStyleId = (typeof textProps.textStyleId === 'string') ? textProps.textStyleId : '';
          textbox.fillStyleId = (typeof textProps.fillStyleId === 'string') ? textProps.fillStyleId : '';

          columns.appendChild(textbox);
        }

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
      })

    } else {
      figma.notify('❌ Please select a textbox to create columns ❌', { timeout: 3000 })
    }
  }
}

