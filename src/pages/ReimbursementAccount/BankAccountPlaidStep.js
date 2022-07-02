import _ from 'underscore';
import React from 'react';
import {View} from 'react-native';
import {withOnyx} from 'react-native-onyx';
import lodashGet from 'lodash/get';
import PropTypes from 'prop-types';
import HeaderWithCloseButton from '../../components/HeaderWithCloseButton';
import CONST from '../../CONST';
import * as BankAccounts from '../../libs/actions/BankAccounts';
import Navigation from '../../libs/Navigation/Navigation';
import styles from '../../styles/styles';
import withLocalize, {withLocalizePropTypes} from '../../components/withLocalize';
import compose from '../../libs/compose';
import ONYXKEYS from '../../ONYXKEYS';
import FormScrollView from '../../components/FormScrollView';
import FormAlertWithSubmitButton from '../../components/FormAlertWithSubmitButton';
import AddPlaidBankAccount from '../../components/AddPlaidBankAccount';
import * as ReimbursementAccount from '../../libs/actions/ReimbursementAccount';

const propTypes = {
    /** The OAuth URI + stateID needed to re-initialize the PlaidLink after the user logs into their bank */
    receivedRedirectURI: PropTypes.string,

    /** During the OAuth flow we need to use the plaidLink token that we initially connected with */
    plaidLinkOAuthToken: PropTypes.string,

    reimbursementAccountDraft: PropTypes.shape(CONST.BANK_ACCOUNT.REIMBURSEMENT_ACCOUNT_DRAFT_PROPS),

    ...withLocalizePropTypes,
};

const defaultProps = {
    receivedRedirectURI: null,
    plaidLinkOAuthToken: '',
    reimbursementAccountDraft: {
        bankAccountID: 0,
        error: '',
        loading: false,
    },
};

class BankAccountPlaidStep extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            selectedPlaidBankAccount: undefined,
        };

        this.submit = this.submit.bind(this);
    }

    submit() {
        const selectedPlaidBankAccount = this.state.selectedPlaidBankAccount;
        if (!selectedPlaidBankAccount) {
            return;
        }

        ReimbursementAccount.updateReimbursementAccountDraft({
            routingNumber: selectedPlaidBankAccount.routingNumber,
            accountNumber: selectedPlaidBankAccount.accountNumber,
            plaidMask: selectedPlaidBankAccount.mask,
            isSavings: selectedPlaidBankAccount.isSavings,
            bankName: selectedPlaidBankAccount.bankName,
            plaidAccountID: selectedPlaidBankAccount.plaidAccountID,
            plaidAccessToken: selectedPlaidBankAccount.plaidAccessToken,
        });

        BankAccounts.updateBankAccountPlaidInfoForVBBA(
            this.props.reimbursementAccountDraft.bankAccountID,
            this.state.selectedPlaidBankAccount,
        );
    }

    render() {
        const error = lodashGet(this.props, 'reimbursementAccount.error', '');
        const loading = lodashGet(this.props, 'reimbursementAccount.loading', false);

        return (
            <>
                <HeaderWithCloseButton
                    title={this.props.translate('workspace.common.bankAccount')}
                    stepCounter={{step: 1, total: 5}}
                    shouldShowGetAssistanceButton
                    guidesCallTaskID={CONST.GUIDES_CALL_TASK_IDS.WORKSPACE_BANK_ACCOUNT}
                    shouldShowBackButton
                    onBackButtonPress={() => BankAccounts.setBankAccountSubStep(null)}
                    onCloseButtonPress={Navigation.dismissModal}
                />
                <FormScrollView>
                    <View style={[styles.mh5, styles.mb5]}>
                        <AddPlaidBankAccount
                            text={this.props.translate('bankAccount.plaidBodyCopy')}
                            onSelect={(params) => {
                                this.setState({
                                    selectedPlaidBankAccount: params.selectedPlaidBankAccount,
                                });
                            }}
                            onExitPlaid={() => BankAccounts.setBankAccountSubStep(null)}
                            receivedRedirectURI={this.props.receivedRedirectURI}
                            plaidLinkOAuthToken={this.props.plaidLinkOAuthToken}
                            allowDebit
                            bankAccountID={this.props.reimbursementAccountDraft.bankAccountID}
                        />
                    </View>
                    {!_.isUndefined(this.state.selectedPlaidBankAccount) && (
                        <FormAlertWithSubmitButton
                            isAlertVisible={Boolean(error)}
                            buttonText={this.props.translate('common.saveAndContinue')}
                            onSubmit={this.submit}
                            message={error}
                            isLoading={loading}
                        />
                    )}
                </FormScrollView>
            </>
        );
    }
}

BankAccountPlaidStep.propTypes = propTypes;
BankAccountPlaidStep.defaultProps = defaultProps;
export default compose(
    withLocalize,
    withOnyx({
        reimbursementAccountDraft: {
            key: ONYXKEYS.REIMBURSEMENT_ACCOUNT_DRAFT,
        },
    }),
)(BankAccountPlaidStep);
