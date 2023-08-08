figma.showUI(__html__, {
  width: 340,
  height: 253
});

figma.ui.onmessage = async (msg: { type: string, [key: string]: any }) => {
  if (msg.type === 'create-columns') {
    const {
      columnCount: colCount,
      width,
      widthType,
      columnGutter: colGutter,
      priority: colPriority,
      removeLinebreaks,
    } = msg;

    const elem = figma.currentPage.selection[0] as TextNode;

    if (!elem || elem.type !== 'TEXT') {
      figma.notify('❌ Please select a textbox to create columns ❌', { timeout: 3000 });
      return;
    }

    async function removeWeirdChars(text: string): Promise<string> {
      // Function to remove any weird invisible characters in the string that Figma returns
      let textString = text.replace(/\u2028|\u2029/gm, '');

      // Remove line breaks if chosen in the UI
      if (removeLinebreaks) {
        textString = textString.replace(/(\r\n|\r|\n){2,}/g, '\n');
      }
      return textString;
    }

    const value = await removeWeirdChars(elem.characters);
    const splitIndex = Math.round(value.length / colCount);
    
    const pattern = (colPriority === 'paragraphs') ? '(.|\\n|\\r){1,' + splitIndex + '}[^\\s]*.*'
    : (colPriority === 'evenness') ? '(.|\\n|\\r){1,' + splitIndex + '}[^\\s]*'
      : '^(.|\\n|\\r){' + splitIndex + '}[^\\s]*';

    const re = new RegExp(pattern, 'gm');
    const matches = value.match(re);

    if (matches === null) {
      figma.notify(
        '❌ There may be invisible characters in your text. Please visit the plugin page / github for more info. ❌',
        { timeout: 3000 }
      );
      return;
    }

    const textArray = matches.map((match: string, i: number) => {
     return match = match.replace(/^(\r\n|\n|\r)/, '');
    });

    const columns = figma.createFrame();
    columns.layoutMode = 'HORIZONTAL';
    columns.itemSpacing = colGutter;
    columns.clipsContent = false;
    columns.primaryAxisSizingMode = 'AUTO';
    columns.counterAxisSizingMode = 'AUTO';
    columns.fills = [{ visible: false, type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

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
      // Load required fonts
      await Promise.all([
        figma.loadFontAsync({ family: 'Roboto', style: 'Regular' }),
        figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
        figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
      ]);

      for (let i = 0; i < textArray.length; i++) {
        const textbox = figma.createText();
        textbox.characters = textArray[i];
        textbox.resize(width, 500);
        textbox.textAutoResize = 'HEIGHT';
        textbox.paragraphSpacing = elem.paragraphSpacing;

        textbox.fills = elem.fills.map(fill => ({
          ...fill,
          blendMode: elem.fills[0].type === 'SOLID' ? fill.blendMode : undefined,
        }));

        if (  elem.fontName !== figma.mixed ) {
          await figma.loadFontAsync({ family: elem.fontName.family, style: elem.fontName.style })
          textbox.fontName = {
            family: elem.fontName.family || 'Inter',
            style: elem.fontName.style || 'Regular',
          };
        }
     
        textbox.fontSize = elem.fontSize !== figma.mixed ? elem.fontSize : 12;
        textbox.textCase = elem.textCase || 'ORIGINAL';
        textbox.textDecoration = elem.textDecoration !== figma.mixed ? elem.textDecoration : 'NONE';
        textbox.textAlignHorizontal = elem.textAlignHorizontal;
        textbox.opacity = elem.opacity || 1;
        textbox.paragraphIndent = elem.paragraphIndent;
        textbox.leadingTrim = elem.leadingTrim;
        textbox.lineHeight = {
          unit: elem.lineHeight ? elem.lineHeight.unit : 'AUTO',
          value: elem.lineHeight ? elem.lineHeight.value : 0,
        };
        textbox.letterSpacing = {
          unit: elem.letterSpacing ? elem.letterSpacing.unit : 'AUTO',
          value: elem.letterSpacing ? elem.letterSpacing.value : 0,
        };
        textbox.textStyleId = elem.textStyleId !== figma.mixed ? elem.textStyleId : '' ||'';
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
    }

    await createTextbox();

    const x = elem.x;
    const y = elem.y;
    columns.x = x + elem.width + 50;
    columns.y = y;
    figma.viewport.scrollAndZoomIntoView([columns]);
    figma.viewport.zoom = 0.5;
    figma.currentPage.selection = [columns];
  }
};
