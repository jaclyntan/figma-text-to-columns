figma.showUI(__html__, {
  width: 340,
  height: 253
});


figma.ui.onmessage = async (msg) => {
  if (msg.type === 'create-columns') {
    const {
      width,
      widthType,
      columnCount: colCount,
      columnGutter: colGutter,
      priority: colPriority,
      removeLinebreaks,
    } = msg;

    //get selection
    const elem = figma.currentPage.selection[0] as TextNode;

    // create autolayout frame for the columns
    const columns = figma.createFrame();
    columns.layoutMode = 'HORIZONTAL';
    columns.itemSpacing = colGutter;
    columns.clipsContent = false;
    columns.primaryAxisSizingMode = 'AUTO';
    columns.counterAxisSizingMode = 'AUTO';
    columns.fills = [{ visible: false, type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];


    if (!elem || elem.type !== 'TEXT') {
      figma.notify('❌ Select a text element to continue ❌', { timeout: 3000 });
      return;
    }

    function removeWeirdChars(text: string): string {
      // Function to remove any weird invisible characters in the string that Figma returns
      let textString = text.replace(/\u2028|\u2029/gm, '');

      // Remove line breaks if chosen in the UI
      if (removeLinebreaks) {
        textString = textString.replace(/(\r\n|\r|\n){2,}/g, '\n');
      }
      return textString;
    }

    // function to create each column
    async function createTextbox(text: string, elem: TextNode) {
      // Load required fonts asynchronously
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
      const textbox = figma.createText();
      textbox.characters = text;
      textbox.resize(width, 500);
      textbox.textAutoResize = 'HEIGHT';
      textbox.paragraphSpacing = elem.paragraphSpacing;
      // console.log(elem.textStyleId)
      // Set font properties
      textbox.fontName = elem.fontName !== figma.mixed ? elem.fontName : { family: 'Inter', style: 'Regular' };
      textbox.fontSize = elem.fontSize !== figma.mixed ? elem.fontSize : 12;
      textbox.textCase = elem.textCase !== figma.mixed ? elem.textCase : 'ORIGINAL';
      textbox.textDecoration = elem.textDecoration !== figma.mixed ? elem.textDecoration : 'NONE';
      // Set other properties
      textbox.fills = elem.fills;
      textbox.opacity = elem.opacity || 1;
      textbox.paragraphIndent = elem.paragraphIndent;
      textbox.leadingTrim = elem.leadingTrim;
      textbox.lineHeight = elem.lineHeight !== figma.mixed ? elem.lineHeight : { unit: 'AUTO' };
      textbox.letterSpacing = elem.letterSpacing !== figma.mixed ? elem.letterSpacing : { unit: 'PERCENT', value: 0 };
      textbox.textStyleId = elem.textStyleId && elem.textStyleId !== figma.mixed ? elem.textStyleId : '';
      textbox.fillStyleId = elem.fillStyleId || '';
      textbox.effectStyleId = elem.effectStyleId || '';

      columns.appendChild(textbox);

      if (widthType === 'container') {
        columns.resize(width, 100);
        textbox.layoutSizingHorizontal = 'FILL';
        textbox.layoutSizingVertical = 'HUG';
        columns.layoutSizingVertical = 'HUG';
      } else {
        textbox.resize(width, 100);
        textbox.layoutSizingVertical = 'HUG';
        columns.layoutSizingVertical = 'HUG';
        columns.layoutSizingHorizontal = 'HUG';
      }
    }


    // start processing text
    const value = removeWeirdChars(elem.characters);
    const splitIndex = Math.round(value.length / colCount);

    const pattern = (colPriority === 'paragraphs')
      ? `(.|\\n|\\r){1,${splitIndex}}[^\\s]*.*`
      : (colPriority === 'evenness')
        ? `(.|\\n|\\r){1,${splitIndex}}[^\\s]*`
        : `^(.|\\n|\\r){${splitIndex}}[^\\s]*`;

    const re = new RegExp(pattern, 'gm');
    const matches = value.match(re);

    if (!matches) {
      figma.notify('❌ There may be invisible characters in your text ❌', { timeout: 3000 });
      return;
    }

    const textArray = matches.map((match: string) => match.replace(/^(\r\n|\n|\r)/, ''));

    if (figma.editorType === 'figjam') {
      columns.x = elem.x + elem.width + 100;
      columns.y = elem.y;
      figma.currentPage.appendChild(columns);
    } else {
      columns.x = 0;
      columns.y = 0;
      if (elem.parent) {
        elem.parent.appendChild(columns);
      } else {
        figma.currentPage.appendChild(columns)
      }
    }

    if (elem.fontName !== figma.mixed) {
      await Promise.all([
        figma.loadFontAsync(elem.fontName),
      ]).then((e) => {
        textArray.forEach((text) => {
          createTextbox(text, elem);
        });
      });
    } else {
      textArray.forEach((text) => {
        createTextbox(text, elem);
      });

      figma.notify('❗️ The typography has been reset due to the text frame containing mixed styles', { timeout: 3000 });
    }

    // place columns
    const x = elem.x;
    const y = elem.y;
    columns.x = x + elem.width + 50;
    columns.y = y;
    figma.viewport.scrollAndZoomIntoView([columns]);
    figma.viewport.zoom = 0.5;
    figma.currentPage.selection = [columns];

  }

};
