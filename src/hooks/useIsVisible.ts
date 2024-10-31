import {useEffect, useState} from 'react';
import Visibility from '@libs/Visibility';

export default function useIsVisible(): boolean {
    const [isVisible, setIsVisible] = useState(Visibility.isVisible());

    useEffect(() => {
        const unsubscriber = Visibility.onVisibilityChange(() => {
            setIsVisible(Visibility.isVisible());
        });

        return unsubscriber;
    }, []);

    return isVisible;
}
