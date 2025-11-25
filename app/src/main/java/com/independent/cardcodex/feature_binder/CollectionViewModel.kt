package com.independent.cardcodex.feature_binder

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.SpeciesCollectionStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class CollectionViewModel @Inject constructor(
    private val cardDao: CardDao
) : ViewModel() {

    val allSpeciesStatus: StateFlow<List<SpeciesCollectionStatus>> = cardDao.getSpeciesCollectionStatus()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
}
