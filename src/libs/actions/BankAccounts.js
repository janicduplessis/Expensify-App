import lodashGet from 'lodash/get';
import Onyx from 'react-native-onyx';
import CONST from '../../CONST';
import * as DeprecatedAPI from '../deprecatedAPI';
import * as API from '../API';
import * as ReimbursementAccount from './ReimbursementAccount';
import ONYXKEYS from '../../ONYXKEYS';
import Growl from '../Growl';
import * as Localize from '../Localize';
import * as store from './ReimbursementAccount/store';

export {
    setupWithdrawalAccount,
    fetchFreePlanVerifiedBankAccount,
    goToWithdrawalAccountSetupStep,
    showBankAccountErrorModal,
    showBankAccountFormValidationError,
    setBankAccountFormValidationErrors,
    resetReimbursementAccountErrors,
    resetFreePlanBankAccount,
    validateBankAccount,
    hideBankAccountErrors,
    setWorkspaceIDForReimbursementAccount,
    setBankAccountSubStep,
    updateReimbursementAccountDraft,
    requestResetFreePlanBankAccount,
    cancelResetFreePlanBankAccount,
} from './ReimbursementAccount';
export {
    openPlaidBankAccountSelector,
    openPlaidBankLogin,
} from './Plaid';
export {
    fetchOnfidoToken,
    activateWallet,
    fetchUserWallet,
} from './Wallet';

function getOnyxDataForVBBA() {
    return {
        optimisticData: [
            {
                onyxMethod: 'merge',
                key: ONYXKEYS.REIMBURSEMENT_ACCOUNT,
                value: {
                    loading: true,
                    error: '',
                },
            },
        ],

        // No successData because PHP pusher is responsible for setting next step (along with isLoading false)
        failureData: [
            {
                onyxMethod: 'merge',
                key: ONYXKEYS.REIMBURSEMENT_ACCOUNT,
                value: {
                    loading: false,
                    error: Localize.translateLocal('paymentsPage.addBankAccountFailure'),
                },
            },
        ],
    };
}

function updateBankAccountPlaidInfoForVBBA(bankAccountID, selectedPlaidBankAccount) {
    const commandName = 'UpdateBankAccountPlaidInfoForVBBA';

    const parameters = {
        bankAccountID,
        routingNumber: selectedPlaidBankAccount.routingNumber,
        accountNumber: selectedPlaidBankAccount.accountNumber,
        bank: selectedPlaidBankAccount.bankName,
        plaidAccountID: selectedPlaidBankAccount.plaidAccountID,
        plaidAccessToken: selectedPlaidBankAccount.plaidAccessToken,
    };

    API.write(commandName, parameters, getOnyxDataForVBBA());
}

function updateBankAccountManualInfoForVBBA(reimbursementAccountDraft) {
    const commandName = 'UpdateBankAccountManualInfoForVBBA';

    const parameters = {
        bankAccountID: reimbursementAccountDraft.bankAccountID,
        routingNumber: reimbursementAccountDraft.routingNumber,
        accountNumber: reimbursementAccountDraft.accountNumber,
        plaidMask: reimbursementAccountDraft.plaidMask,
    };

    API.write(commandName, parameters, getOnyxDataForVBBA());
}

function updateCompanyInfoForVBBA(reimbursementAccountDraft) {
    const commandName = 'UpdateCompanyInfoForVBBA';

    const parameters = {
        bankAccountID: reimbursementAccountDraft.bankAccountID,

        // Fields from the BankAccountStep
        routingNumber: reimbursementAccountDraft.routingNumber,
        accountNumber: reimbursementAccountDraft.accountNumber,
        bank: reimbursementAccountDraft.bankName,
        plaidAccountID: reimbursementAccountDraft.plaidAccountID,
        isSavings: reimbursementAccountDraft.isSavings,
        plaidAccessToken: reimbursementAccountDraft.plaidAccessToken,

        // Fields from the CompanyStep
        companyName: reimbursementAccountDraft.companyName,
        addressStreet: reimbursementAccountDraft.addressStreet,
        addressCity: reimbursementAccountDraft.addressCity,
        addressState: reimbursementAccountDraft.addressState,
        addressZip: reimbursementAccountDraft.addressZipCode,
        website: reimbursementAccountDraft.website,
        companyTaxID: reimbursementAccountDraft.companyTaxID,
        incorporationDate: reimbursementAccountDraft.incorporationDate,
        incorporationState: reimbursementAccountDraft.incorporationState,
        incorporationType: reimbursementAccountDraft.incorporationType,
        companyPhone: reimbursementAccountDraft.companyPhone,
        hasNoConnectionToCannabis: reimbursementAccountDraft.hasNoConnectionToCannabis,
    };

    API.write(commandName, parameters, getOnyxDataForVBBA());
}

/**
 * We clear these out of storage once we are done with them so the user must re-enter Plaid credentials upon returning.
 * @param {String} onyxKey
 */
function clearOnyxObject(onyxKey) {
    Onyx.set(onyxKey, {});
}

/**
 * Adds a bank account via Plaid
 *
 * @param {Object} account
 * @param {String} password
 */
function addPersonalBankAccount(account, password) {
    const commandName = 'AddPersonalBankAccount';

    const parameters = {
        addressName: account.addressName,
        routingNumber: account.routingNumber,
        accountNumber: account.accountNumber,
        isSavings: account.isSavings,
        setupType: 'plaid',
        bank: account.bankName,
        plaidAccountID: account.plaidAccountID,
        plaidAccessToken: account.plaidAccessToken,
        password,
    };

    const onyxData = {
        optimisticData: [
            {
                onyxMethod: 'merge',
                key: ONYXKEYS.PERSONAL_BANK_ACCOUNT,
                value: {
                    loading: true,
                    error: '',
                },
            },
        ],
        successData: [
            {
                onyxMethod: 'merge',
                key: ONYXKEYS.PERSONAL_BANK_ACCOUNT,
                value: {
                    loading: false,
                    error: '',
                    success: Localize.translateLocal('paymentsPage.addBankAccountSuccess'),
                },
            },
        ],
        failureData: [
            {
                onyxMethod: 'merge',
                key: ONYXKEYS.PERSONAL_BANK_ACCOUNT,
                value: {
                    loading: false,
                    error: Localize.translateLocal('paymentsPage.addBankAccountFailure'),
                },
            },
        ],
    };

    API.write(commandName, parameters, onyxData);
}

/**
 * Deletes a bank account
 *
 * @param {Number} bankAccountID
 */
function deleteBankAccount(bankAccountID) {
    const reimbursementBankAccountId = lodashGet(store.getReimbursementAccountInSetup(), 'bankAccountID');

    // Early return as DeleteBankAccount API is called inside `resetFreePlanBankAccount`
    if (reimbursementBankAccountId === bankAccountID) {
        ReimbursementAccount.resetFreePlanBankAccount();
        return;
    }
    DeprecatedAPI.DeleteBankAccount({
        bankAccountID,
    }).then((response) => {
        if (response.jsonCode === 200) {
            ReimbursementAccount.deleteFromBankAccountList(bankAccountID);
            Growl.show(Localize.translateLocal('paymentsPage.deleteBankAccountSuccess'), CONST.GROWL.SUCCESS, 3000);
        } else {
            Growl.show(Localize.translateLocal('common.genericErrorMessage'), CONST.GROWL.ERROR, 3000);
        }
    }).catch(() => {
        Growl.show(Localize.translateLocal('common.genericErrorMessage'), CONST.GROWL.ERROR, 3000);
    });
}

export {
    addPersonalBankAccount,
    deleteBankAccount,
    clearOnyxObject,
    updateBankAccountPlaidInfoForVBBA,
    updateBankAccountManualInfoForVBBA,
    updateCompanyInfoForVBBA,
};
