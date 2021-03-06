define(["./constants","./svgFactory","./utils"], function(constants, SvgFactory, utils) {

    var svgFactory = new SvgFactory();

    function RowRenderer(gridOptions, rowModel, colModel, gridOptionsWrapper, eGrid,
                         angularGrid, selectionRendererFactory, $compile, $scope,
                         selectionController) {
        this.gridOptions = gridOptions;
        this.rowModel = rowModel;
        this.colModel = colModel;
        this.gridOptionsWrapper = gridOptionsWrapper;
        this.angularGrid = angularGrid;
        this.selectionRendererFactory = selectionRendererFactory;
        this.findAllElements(eGrid);
        this.$compile = $compile;
        this.$scope = $scope;
        this.selectionController = selectionController;

        // map of row ids to row objects. keeps track of which elements
        // are rendered for which rows in the dom. each row object has:
        // [scope, bodyRow, pinnedRow, rowData]
        this.renderedRows = {};

        this.editingCell = false; //gets set to true when editing a cell
    }

    RowRenderer.prototype.setMainRowWidths = function() {
        var mainRowWidth = this.colModel.getTotalUnpinnedColWidth() + "px";

        var unpinnedRows = this.eBodyContainer.querySelectorAll(".ag-row");
        for (var i = 0; i<unpinnedRows.length; i++) {
            unpinnedRows[i].style.width = mainRowWidth;
        }
    };

    RowRenderer.prototype.findAllElements = function (eGrid) {
        if (this.gridOptionsWrapper.isDontUseScrolls()) {
            this.eBodyContainer = eGrid.querySelector(".ag-body-container");
        } else {
            this.eBodyContainer = eGrid.querySelector(".ag-body-container");
            this.eBodyViewport = eGrid.querySelector(".ag-body-viewport");
            this.ePinnedColsContainer = eGrid.querySelector(".ag-pinned-cols-container");
        }
    };

    RowRenderer.prototype.refreshView = function() {
        if (!this.gridOptionsWrapper.isDontUseScrolls()) {
            var rowCount = this.rowModel.getRowsAfterMap().length;
            var containerHeight = this.gridOptionsWrapper.getRowHeight() * rowCount;
            this.eBodyContainer.style.height = containerHeight + "px";
            this.ePinnedColsContainer.style.height = containerHeight + "px";
        }

        this.refreshAllVirtualRows();
    };

    RowRenderer.prototype.rowDataChanged = function(rows) {
        // convert to nodes, and call other function.
        // we only need to be worried about rendered rows,
        // as this method is called to whats rendered.
        // if the row isn't rendered, we don't care
        var nodes = [];
        var renderedRows = this.renderedRows;
        Object.keys(renderedRows).forEach(function (key) {
            var renderedRow = renderedRows[key];
            // see if the rendered row is in the list of rows we have to update
            var rowNeedsUpdating = rows.indexOf(renderedRow.node.data) >= 0;
            if (rowNeedsUpdating) {
                nodes.push(renderedRow.node);
            }
        });

        this.rowNodesChanged(nodes);
    };

    RowRenderer.prototype.rowNodesChanged = function(nodes) {
        // get indexes for the rows
        var indexesToRemove = [];
        var rowsAfterMap = this.rowModel.getRowsAfterMap();
        nodes.forEach(function(row) {
            var index = rowsAfterMap.indexOf(row);
            if (index>=0) {
                indexesToRemove.push(index);
            }
        });
        // remove the rows
        this.removeVirtualRows(indexesToRemove);
        // add draw them again
        this.drawVirtualRows();
    };

    RowRenderer.prototype.refreshAllVirtualRows = function () {
        //remove all current virtual rows, as they have old data
        var rowsToRemove = Object.keys(this.renderedRows);
        this.removeVirtualRows(rowsToRemove);

        //add in new rows
        this.drawVirtualRows();
    };

    //takes array of row id's
    RowRenderer.prototype.removeVirtualRows = function (rowsToRemove) {
        var that = this;
        rowsToRemove.forEach(function (indexToRemove) {
            var renderedRow = that.renderedRows[indexToRemove];
            if (renderedRow.pinnedElement && that.ePinnedColsContainer) {
                that.ePinnedColsContainer.removeChild(renderedRow.pinnedElement);
            }

            if (renderedRow.bodyElement) {
                that.eBodyContainer.removeChild(renderedRow.bodyElement);
            }

            if (renderedRow.scope) {
                renderedRow.scope.$destroy();
            }

            if (that.gridOptionsWrapper.getVirtualRowRemoved()) {
                that.gridOptionsWrapper.getVirtualRowRemoved()(renderedRow.data, indexToRemove);
            }
            that.angularGrid.onVirtualRowRemoved(indexToRemove);

            delete that.renderedRows[indexToRemove];
        });
    };

    RowRenderer.prototype.drawVirtualRows = function() {
        var first;
        var last;

        var rowCount = this.rowModel.getRowsAfterMap().length;

        if (this.gridOptionsWrapper.isDontUseScrolls()) {
            first = 0;
            var rowsAfterMap = this.rowModel.getRowsAfterMap();
            if (rowsAfterMap) {
                last = rowCount - 1;
            } else {
                last = 0;
            }
        } else {
            var topPixel = this.eBodyViewport.scrollTop;
            var bottomPixel = topPixel + this.eBodyViewport.offsetHeight;

            first = Math.floor(topPixel / this.gridOptionsWrapper.getRowHeight());
            last = Math.floor(bottomPixel / this.gridOptionsWrapper.getRowHeight());

            //add in buffer
            first = first - constants.ROW_BUFFER_SIZE;
            last = last + constants.ROW_BUFFER_SIZE;

            // adjust, in case buffer extended actual size
            if (first < 0) {
                first = 0;
            }
            if (last > rowCount - 1) {
                last = rowCount - 1;
            }
        }

        this.firstVirtualRenderedRow = first;
        this.lastVirtualRenderedRow = last;

        this.ensureRowsRendered();
    };

    RowRenderer.prototype.isIndexRendered = function (index) {
        return index >= this.firstVirtualRenderedRow && index <= this.lastVirtualRenderedRow;
    };

    RowRenderer.prototype.getFirstVirtualRenderedRow = function () {
        return this.firstVirtualRenderedRow;
    };

    RowRenderer.prototype.getLastVirtualRenderedRow = function () {
        return this.lastVirtualRenderedRow;
    };

    RowRenderer.prototype.ensureRowsRendered = function () {

        var pinnedColumnCount = this.gridOptionsWrapper.getPinnedColCount();
        var mainRowWidth = this.colModel.getTotalUnpinnedColWidth();
        var that = this;

        //at the end, this array will contain the items we need to remove
        var rowsToRemove = Object.keys(this.renderedRows);

        //add in new rows
        for (var rowIndex = this.firstVirtualRenderedRow; rowIndex <= this.lastVirtualRenderedRow; rowIndex++) {
            //see if item already there, and if yes, take it out of the 'to remove' array
            if (rowsToRemove.indexOf(rowIndex.toString()) >= 0) {
                rowsToRemove.splice(rowsToRemove.indexOf(rowIndex.toString()), 1);
                continue;
            }
            //check this row actually exists (in case overflow buffer window exceeds real data)
            var node = this.rowModel.getVirtualRow(rowIndex);
            if (node) {
                that.insertRow(node, rowIndex, mainRowWidth, pinnedColumnCount);
            }
        }

        //at this point, everything in our 'rowsToRemove' . . .
        this.removeVirtualRows(rowsToRemove);

        //if we are doing angular compiling, then do digest the scope here
        if (this.gridOptions.angularCompileRows) {
            // we do it in a timeout, in case we are already in an apply
            setTimeout(function () {
                that.$scope.$apply();
            }, 0);
        }
    };

    RowRenderer.prototype.insertRow = function(node, rowIndex, mainRowWidth, pinnedColumnCount) {
        //if no cols, don't draw row
        if (!this.gridOptionsWrapper.isColumDefsPresent()) { return; }

        //var rowData = node.rowData;
        var rowIsAGroup = node.group;

        var ePinnedRow = this.createRowContainer(rowIndex, node, rowIsAGroup);
        var eMainRow = this.createRowContainer(rowIndex, node, rowIsAGroup);
        var _this = this;

        eMainRow.style.width = mainRowWidth+"px";

        // try compiling as we insert rows
        var newChildScope = this.createChildScopeOrNull(node.data);

        var renderedRow = {
            scope: newChildScope,
            node: node,
            rowIndex: rowIndex
        };
        this.renderedRows[rowIndex] = renderedRow;

        // if group item, insert the first row
        var columnDefWrappers = this.colModel.getColDefWrappers();
        if (rowIsAGroup) {
            var firstColWrapper = columnDefWrappers[0];
            var groupHeaderTakesEntireRow = this.gridOptionsWrapper.isGroupUseEntireRow();

            var eGroupRow = _this.createGroupElement(node, firstColWrapper, groupHeaderTakesEntireRow, false, rowIndex);
            if (pinnedColumnCount>0) {
                ePinnedRow.appendChild(eGroupRow);
            } else {
                eMainRow.appendChild(eGroupRow);
            }

            if (pinnedColumnCount>0 && groupHeaderTakesEntireRow) {
                var eGroupRowPadding = _this.createGroupElement(node, firstColWrapper, groupHeaderTakesEntireRow, true, rowIndex);
                eMainRow.appendChild(eGroupRowPadding);
            }

            if (!groupHeaderTakesEntireRow) {

                //draw in blank cells for the rest of the row
                var groupHasData = node.data !== undefined && node.data !== null;
                columnDefWrappers.forEach(function(colDefWrapper, colIndex) {
                    if (colIndex==0) { //skip first col, as this is the group col we already inserted
                        return;
                    }
                    var item = null;
                    if (groupHasData) {
                        item = node.data[colDefWrapper.colDef.field];
                    }
                    _this.createCellFromColDef(colDefWrapper, item, node, rowIndex, colIndex, pinnedColumnCount, true, eMainRow, ePinnedRow, newChildScope);
                });
            }

        } else {
            columnDefWrappers.forEach(function(colDefWrapper, colIndex) {
                _this.createCellFromColDef(colDefWrapper, node.data[colDefWrapper.colDef.field], node, rowIndex, colIndex, pinnedColumnCount, false, eMainRow, ePinnedRow, newChildScope);
            });
        }

        //try compiling as we insert rows
        renderedRow.pinnedElement = this.compileAndAdd(this.ePinnedColsContainer, rowIndex, ePinnedRow, newChildScope);
        renderedRow.bodyElement = this.compileAndAdd(this.eBodyContainer, rowIndex, eMainRow, newChildScope);
    };

    RowRenderer.prototype.createChildScopeOrNull = function(data) {
        if (this.gridOptionsWrapper.isAngularCompileRows()) {
            var newChildScope = this.$scope.$new();
            newChildScope.data = data;
            return newChildScope;
        } else {
            return null;
        }
    };

    RowRenderer.prototype.compileAndAdd = function(container, rowIndex, element, scope) {
        if (scope) {
            var eElementCompiled = this.$compile(element)(scope);
            if (container) { // checking container, as if noScroll, pinned container is missing
                container.appendChild(eElementCompiled[0]);
            }
            return eElementCompiled[0];
        } else {
            if (container) {
                container.appendChild(element);
            }
            return element;
        }
    };

    RowRenderer.prototype.createCellFromColDef = function(colDefWrapper, value, node, rowIndex, colIndex, pinnedColumnCount, isGroup, eMainRow, ePinnedRow, $childScope) {
        var eGridCell = this.createCell(colDefWrapper, value, node, rowIndex, colIndex, isGroup, $childScope);

        if (colIndex>=pinnedColumnCount) {
            eMainRow.appendChild(eGridCell);
        } else {
            ePinnedRow.appendChild(eGridCell);
        }
    };

    RowRenderer.prototype.createRowContainer = function(rowIndex, node, groupRow) {
        var eRow = document.createElement("div");
        var classesList = ["ag-row"];
        classesList.push(rowIndex%2==0 ? "ag-row-even" : "ag-row-odd");
        if (this.selectionController.isNodeSelected(node)) {
            classesList.push("ag-row-selected");
        }

        // add in extra classes provided by the config
        if (this.gridOptionsWrapper.getRowClass()) {
            var params = {node: node, data: node.data, rowIndex: rowIndex,
                gridOptions: this.gridOptionsWrapper.getGridOptions()};
            var extraRowClasses = this.gridOptionsWrapper.getRowClass()(params);
            if (extraRowClasses) {
                if (typeof extraRowClasses === 'string') {
                    classesList.push(extraRowClasses);
                } else if (Array.isArray(extraRowClasses)) {
                    extraRowClasses.forEach(function(classItem) {
                        classesList.push(classItem);
                    });
                }
            }
        }

        var classes = classesList.join(" ");

        eRow.className = classes;

        eRow.setAttribute("row", rowIndex);

        // if showing scrolls, position on the container
        if (!this.gridOptionsWrapper.isDontUseScrolls()) {
            eRow.style.top = (this.gridOptionsWrapper.getRowHeight() * rowIndex) + "px";
        }
        eRow.style.height = (this.gridOptionsWrapper.getRowHeight()) + "px";

        if (this.gridOptionsWrapper.getRowStyle()) {
            var cssToUse;
            var rowStyle = this.gridOptionsWrapper.getRowStyle();
            if (typeof rowStyle === 'function') {
                cssToUse = rowStyle(node.data, rowIndex, groupRow);
            } else {
                cssToUse = rowStyle;
            }

            if (cssToUse) {
                Object.keys(cssToUse).forEach(function(key) {
                    eRow.style[key] = cssToUse[key];
                });
            }
        }

        if (!groupRow) {
            var _this = this;
            eRow.addEventListener("click", function(event) {
                _this.angularGrid.onRowClicked(event, Number(this.getAttribute("row")))
            });
        }

        return eRow;
    };

    RowRenderer.prototype.getIndexOfRenderedNode = function(node) {
        var renderedRows = this.renderedRows;
        var keys = Object.keys(renderedRows);
        for (var i = 0; i<keys.length; i++) {
            if (renderedRows[keys[i]].node === node) {
                return renderedRows[keys[i]].rowIndex;
            }
        }
        return -1;
    };

    RowRenderer.prototype.createGroupElement = function(node, firstColDefWrapper, useEntireRow, padding, rowIndex) {
        var eGridGroupRow = document.createElement('div');
        if (useEntireRow) {
            eGridGroupRow.className = 'ag-group-cell-entire-row';
        } else {
            eGridGroupRow.className = 'ag-group-cell ag-cell cell-col-'+0;
        }

        if (!padding) {
            this.addGroupExpandIcon(eGridGroupRow, node.expanded);
        }

        // if selection, add in selection box
        if (!padding && this.gridOptionsWrapper.isGroupCheckboxSelection()) {
            var eCheckbox = this.selectionRendererFactory.createSelectionCheckbox(node, rowIndex);
            eGridGroupRow.appendChild(eCheckbox);
        }

        // if renderer provided, use it
        if (this.gridOptions.groupInnerCellRenderer) {
            var rendererParams = {
                data: node.data, node: node, padding: padding, gridOptions: this.gridOptions
            };
            var resultFromRenderer = this.gridOptions.groupInnerCellRenderer(rendererParams);
            if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
                //a dom node or element was returned, so add child
                eGridGroupRow.appendChild(resultFromRenderer);
            } else {
                //otherwise assume it was html, so just insert
                var eTextSpan = document.createElement('span');
                eTextSpan.innerHTML = resultFromRenderer;
                eGridGroupRow.appendChild(eTextSpan);
            }
        } else {
            // otherwise default is display the key along with the child count
            if (!padding) { //only do it if not padding - if we are padding, we display blank row
                var textToDisplay = " " + node.key;
                // only include the child count if it's included, eg if user doing custom aggregation,
                // then this could be left out, or set to -1, ie no child count
                if (node.allChildrenCount >= 0) {
                    textToDisplay += " (" + node.allChildrenCount + ")";
                }
                var eText = document.createTextNode(textToDisplay);
                eGridGroupRow.appendChild(eText);
            }
        }

        if (!useEntireRow) {
            eGridGroupRow.style.width = utils.formatWidth(firstColDefWrapper.actualWidth);
        }

        // indent with the group level
        if (!padding) {
            // only do this if an indent - as this overwrites the padding that
            // the theme set, which will make things look 'not aligned' for the
            // first group level.
            if (node.level > 0) {
                eGridGroupRow.style.paddingLeft = (node.level * 10) + "px";
            }
        }

        var _this = this;
        eGridGroupRow.addEventListener("click", function() {
            node.expanded = !node.expanded;
            _this.angularGrid.updateModelAndRefresh(constants.STEP_MAP);
        });

        return eGridGroupRow;
    };

    RowRenderer.prototype.addGroupExpandIcon = function(eGridGroupRow, expanded) {
        var groupIconRenderer = this.gridOptionsWrapper.getGroupIconRenderer();

        // if no renderer for group icon, use the default
        if (typeof groupIconRenderer !== 'function') {
            var eSvg = svgFactory.createGroupSvg(expanded);
            eGridGroupRow.appendChild(eSvg);
            return;
        }

        // otherwise, use the renderer
        var resultFromRenderer = groupIconRenderer(expanded);
        if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
            //a dom node or element was returned, so add child
            eGridGroupRow.appendChild(resultFromRenderer);
        } else {
            //otherwise assume it was html, so just insert
            var eTextSpan = document.createElement('span');
            eTextSpan.innerHTML = resultFromRenderer;
            eGridGroupRow.appendChild(eTextSpan);
        }

    };

    RowRenderer.prototype.putDataIntoCell = function(colDef, value, node, $childScope, eGridCell, rowIndex) {
        if (colDef.cellRenderer) {
            var rendererParams = {
                value: value, data: node.data, node: node, colDef: colDef, $scope: $childScope, rowIndex: rowIndex,
                gridOptions: this.gridOptionsWrapper.getGridOptions()
            };
            var resultFromRenderer = colDef.cellRenderer(rendererParams);
            if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
                //a dom node or element was returned, so add child
                eGridCell.appendChild(resultFromRenderer);
            } else {
                //otherwise assume it was html, so just insert
                eGridCell.innerHTML = resultFromRenderer;
            }
        } else {
            //if we insert undefined, then it displays as the string 'undefined', ugly!
            if (value!==undefined && value!==null && value!=='') {
                eGridCell.innerHTML = value;
            }
        }
    };

    RowRenderer.prototype.putDataAndSelectionCheckboxIntoCell = function(colDef, value, node, $childScope, eGridCell, rowIndex) {
        var eCellWrapper = document.createElement('span');

        eGridCell.appendChild(eCellWrapper);

        var eCheckbox = this.selectionRendererFactory.createSelectionCheckbox(node, rowIndex);
        eCellWrapper.appendChild(eCheckbox);

        var eDivWithValue = document.createElement("span");
        eCellWrapper.appendChild(eDivWithValue);

        this.putDataIntoCell(colDef, value, node, $childScope, eDivWithValue, rowIndex);
    };

    RowRenderer.prototype.createCell = function(colDefWrapper, value, node, rowIndex, colIndex, isGroup, $childScope) {
        var that = this;
        var eGridCell = document.createElement("div");
        eGridCell.setAttribute("col", colIndex);

        // set class, only include ag-group-cell if it's a group cell
        var classes = ['ag-cell', 'cell-col-'+colIndex];
        if (isGroup) {
            classes.push('ag-group-cell');
        }
        eGridCell.className = classes.join(' ');

        var colDef = colDefWrapper.colDef;
        if (colDef.checkboxSelection) {
            this.putDataAndSelectionCheckboxIntoCell(colDef, value, node, $childScope, eGridCell, rowIndex);
        } else {
            this.putDataIntoCell(colDef, value, node, $childScope, eGridCell, rowIndex);
        }

        if (colDef.cellStyle) {
            var cssToUse;
            if (typeof colDef.cellStyle === 'function') {
                var cellStyleParams = {value: value, data: node.data, node: node, colDef: colDef, $scope: $childScope,
                    gridOptions: this.gridOptionsWrapper.getGridOptions()};
                cssToUse = colDef.cellStyle(cellStyleParams);
            } else {
                cssToUse = colDef.cellStyle;
            }

            if (cssToUse) {
                Object.keys(cssToUse).forEach(function(key) {
                    eGridCell.style[key] = cssToUse[key];
                });
            }
        }

        if (colDef.cellClass) {
            var classToUse;
            if (typeof colDef.cellClass === 'function') {
                var cellClassParams = {value: value, data: node.data, node: node, colDef: colDef, $scope: $childScope,
                    gridOptions: this.gridOptionsWrapper.getGridOptions()};
                classToUse = colDef.cellClass(cellClassParams);
            } else {
                classToUse = colDef.cellClass;
            }

            if (typeof classToUse === 'string') {
                utils.addCssClass(eGridCell, classToUse);
            } else if (Array.isArray(classToUse)) {
                classToUse.forEach(function(cssClassItem) {
                    utils.addCssClass(eGridCell,cssClassItem);
                });
            }
        }

        eGridCell.addEventListener("click", function(event) {
            if (that.gridOptionsWrapper.getCellClicked()) {
                that.gridOptionsWrapper.getCellClicked()(node.data, colDef, event, this, that.gridOptionsWrapper.getGridOptions());
            }
            if (colDef.cellClicked) {
                colDef.cellClicked(node.data, colDef, event, this, that.gridOptionsWrapper.getGridOptions());
            }
            if (that.isCellEditable(colDef, node.data)) {
                that.startEditing(eGridCell, colDefWrapper, node, $childScope);
            }
        });

        eGridCell.style.width = utils.formatWidth(colDefWrapper.actualWidth);

        return eGridCell;
    };

    RowRenderer.prototype.isCellEditable = function(colDef, data) {
        if (this.editingCell) {
            return false;
        }

        if (typeof colDef.editable === 'boolean') {
            return colDef.editable;
        }

        if (typeof colDef.editable === 'function') {
            return colDef.editable(data);
        }

        return false;
    };

    RowRenderer.prototype.stopEditing = function(eGridCell, colDef, node, $childScope, eInput, blurListener) {
        this.editingCell = false;
        var newValue = eInput.value;

        //If we don't remove the blur listener first, we get:
        //Uncaught NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is no longer a child of this node. Perhaps it was moved in a 'blur' event handler?
        eInput.removeEventListener('blur', blurListener);

        utils.removeAllChildren(eGridCell);

        if (colDef.newValueHandler) {
            colDef.newValueHandler(node.data, newValue, colDef, this.gridOptionsWrapper.getGridOptions());
        } else {
            node.data[colDef.field] = newValue;
        }

        var value = node.data[colDef.field];
        this.putDataIntoCell(colDef, value, node, $childScope, eGridCell);
    };

    RowRenderer.prototype.startEditing = function(eGridCell, colDefWrapper, node, $childScope) {
        var that = this;
        var colDef = colDefWrapper.colDef;
        this.editingCell = true;
        utils.removeAllChildren(eGridCell);
        var eInput = document.createElement('input');
        eInput.type = 'text';
        utils.addCssClass(eInput, 'ag-cell-edit-input');

        var value = node.data[colDef.field];
        if (value!==null && value!==undefined) {
            eInput.value = value;
        }

        eInput.style.width = (colDefWrapper.actualWidth - 14) + 'px';
        eGridCell.appendChild(eInput);
        eInput.focus();
        eInput.select();

        var blurListener = function() {
            that.stopEditing(eGridCell, colDef, node, $childScope, eInput, blurListener);
        };

        //stop entering if we loose focus
        eInput.addEventListener("blur", blurListener);

        //stop editing if enter pressed
        eInput.addEventListener('keypress', function (event) {
            var key = event.which || event.keyCode;
            if (key == 13) { // 13 is enter
                that.stopEditing(eGridCell, colDef, node, $childScope, eInput, blurListener);
            }
        });

    };

    return RowRenderer;

});