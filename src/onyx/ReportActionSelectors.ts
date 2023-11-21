import {getSortedReportActionsForDisplay} from '@libs/ReportActionsUtils';
import ONYXKEYS from '@src/ONYXKEYS';

function getSortedReportActionsForDisplaySelector<T>(getReportID: (props: T) => string) {
    return {
        key: (props: T) => `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${getReportID(props)}`,
        canEvict: false,
        selector: getSortedReportActionsForDisplay,
        selectorCacheKey: (props: T) => `${ONYXKEYS.COLLECTION.SORTED_REPORT_ACTIONS_FOR_DISPLAY}${getReportID(props)}`,
    };
}

export default {getSortedReportActionsForDisplaySelector};
