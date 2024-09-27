import {CellContainer} from '@shopify/flash-list';
import type {CellContainerProps} from '@shopify/flash-list/dist/native/cell-container/CellContainer';
import React from 'react';

function CellRendererComponent(props: CellContainerProps) {
    return (
        <CellContainer
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...props}
            style={[
                props.style,
                /**
                 * To achieve absolute positioning and handle overflows for list items,
                 * it is necessary to assign zIndex values. In the case of inverted lists,
                 * the lower list items will have higher zIndex values compared to the upper
                 * list items. Consequently, lower list items can overflow the upper list items.
                 * See: https://github.com/Expensify/App/issues/20451
                 */
                {zIndex: -props.index},
            ]}
        />
    );
}

CellRendererComponent.displayName = 'CellRendererComponent';

export default CellRendererComponent;
