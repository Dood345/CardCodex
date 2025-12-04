package com.independent.cardcodex.feature_binder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.independent.cardcodex.ui.components.CodexItem
import com.independent.cardcodex.feature_pokedex.CodexEntry

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(
    onSpeciesClick: (Int) -> Unit,
    viewModel: CollectionViewModel = hiltViewModel()
) {
    val speciesStatusList by viewModel.allSpeciesStatus.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("My Collection") }) }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 100.dp),
                contentPadding = PaddingValues(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(speciesStatusList) { status ->
                    val entry = CodexEntry(
                        id = status.species.id.toString(),
                        name = status.species.name,
                        iconUrl = status.species.iconUrl,
                        type = status.species.types.firstOrNull(),
                        isSpecies = true,
                        speciesId = status.species.id
                    )
                    CodexItem(
                        entry = entry, 
                        onClick = { onSpeciesClick(status.species.id) },
                        isOwned = status.isOwned
                    )
                }
            }
        }
    }
}
