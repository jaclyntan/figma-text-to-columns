

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
        //note: for some reason figma removes <br>'s when it returns a text node's characters. Will patch if this is updated in the future
        var text = elem.characters;
        const splitIndex = Math.round(text.length / colCount);
        const textArray = [];

        async function removeWeirdChars() {
          // this function is for removing any weird invisible chars in the string that Figma returns
          // if you encounter any other weird chars/zero width chars please submit an issue so I can update the regex
          var re = new RegExp('\\u2028|\\u2029', 'g');
          return text.replace(re, '');
        }

        removeWeirdChars().then(function (value) {

          //regex is used to capture the string without slicing words
          const pattern = '^(.|\\n|\\r){' + splitIndex + '}[^\\s]*';
          var re = new RegExp(pattern, 'g');
          if ( value.match(re) !== null ) {
            for (let i = 1; i <= colCount; i++) {

              // console.log(text.match(re))
              var string = (i === 1) ? value.match(re)[0]
                          : (i === colCount) ? result
                          : result.match(re)[0]

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
        columns.x = elem.x + elem.width + 100;
        columns.y = elem.y;

        figma.currentPage.appendChild(columns);

        async function createTextbox() {

          await figma.loadFontAsync({ family: "Roboto", style: "Regular" })

          // finally, we can loop through our array we made earlier and create text nodes for each of them
          for (let i = 0; i < textArray.length; i++) {
            const textbox = figma.createText();
            textbox.characters = textArray[i];
            textbox.resize(colWidth, 500);
            textbox.textAutoResize = "HEIGHT";
            textbox.textStyleId = (typeof textStyleId === 'string') ? textStyleId : '';
            columns.appendChild(textbox);
          }

        }

        //select and focus on the columns
        createTextbox().then(() => {
          figma.viewport.scrollAndZoomIntoView([columns]);
          figma.viewport.zoom = 0.8;
          figma.currentPage.selection = [columns];
        })

      }

    }

  }

}
